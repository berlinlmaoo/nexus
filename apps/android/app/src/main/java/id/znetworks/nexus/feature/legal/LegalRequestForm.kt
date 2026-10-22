package id.znetworks.nexus.feature.legal

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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Attachment
import androidx.compose.material.icons.filled.Balance
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.util.UUID

// Legal requests, the requester's side (owner, 14 Oct 2026; web LegalRequestForm.tsx / MyLegalRequests.tsx, iOS
// LegalRequestViews): the form behind a link (/f/legal-<token>, any signed-in person), and my own requests in My
// Submissions with the final file once it exists.

/** The request form behind a link. Signed out, the router holds the link through sign-in, then opens this. */
@Composable
fun LegalRequestFormScreen(linkId: String, onBack: () -> Unit, onOpenMine: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<LgFormInfo?>(null) }
    var unknown by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var companyId by remember { mutableStateOf<String?>(null) }
    var templateId by remember { mutableStateOf<String?>(null) }
    val values = remember { mutableStateMapOf<String, LgValue>() }
    var parentNumber by remember { mutableStateOf("") }
    var purpose by remember { mutableStateOf("") }
    var deadline by remember { mutableStateOf<String?>(null) }
    var link by remember { mutableStateOf<LgLink?>(null) }
    var files by remember { mutableStateOf<List<LgPicked>>(emptyList()) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var sentId by remember { mutableStateOf<String?>(null) }
    // One key per filled-in form: a retry after a lost answer is never sent twice; "Send another" starts a new one.
    var attempt by remember { mutableStateOf(UUID.randomUUID().toString()) }

    LaunchedEffect(tick) {
        loadError = null; unknown = false
        try {
            val i = api.requestForm(linkId)
            info = i
            companyId = i.lockedCompany?.id ?: i.companies.singleOrNull()?.id
        } catch (e: ApiError) {
            if (e is ApiError.Http && e.status == 404) unknown = true else loadError = legalMessage(ctx, e)
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        // Legal's upload rules: up to 5 files, 50 MB each (the server checks again).
        val picked = uris.mapNotNull(api::describe)
        val tooBig = picked.firstOrNull { it.size > LegalLogic.MAX_ATTACHMENT_BYTES }
        val ok = picked.filter { it.size <= LegalLogic.MAX_ATTACHMENT_BYTES }
        val room = LegalLogic.MAX_ATTACHMENTS - files.size
        files = files + ok.take(room)
        formError = when {
            tooBig != null -> ctx.getString(R.string.lg_file_too_big, tooBig.name)
            ok.size > room -> ctx.getString(R.string.lg_at_most_files, LegalLogic.MAX_ATTACHMENTS)
            else -> null
        }
    }

    fun reset() {
        attempt = UUID.randomUUID().toString()
        templateId = null; values.clear(); parentNumber = ""; purpose = ""; deadline = null; link = null; files = emptyList()
        errors = emptyMap(); formError = null; sentId = null
        info?.let { i -> if (i.lockedCompany == null) companyId = i.companies.singleOrNull()?.id }
    }

    fun send(i: LgFormInfo) {
        val tid = templateId ?: return
        val cid = companyId ?: return
        val addendum = i.templates.firstOrNull { it.id == tid }?.isAddendum == true
        sending = true; formError = null
        scope.launch {
            try {
                val input = LegalLogic.requestInput(tid, cid, values.toMap(), purpose, deadline, link?.projectId, link?.dealId, addendum, parentNumber)
                sentId = api.sendRequest(linkId, input, files, attempt).id
            } catch (e: ApiError) {
                errors = e.legalFieldErrors()
                formError = if (errors.isEmpty()) legalMessage(ctx, e) else ctx.getString(R.string.lg_fields_need_attention)
            }
            sending = false
        }
    }

    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(R.string.lg_request_title), onBack = onBack)
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp).widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(c.muted), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Balance, null, tint = c.mutedFg, modifier = Modifier.size(20.dp))
                }
                val i = info
                when {
                    unknown -> EmptyState(Icons.Filled.LinkOff, stringResource(R.string.lg_link_unknown), stringResource(R.string.lg_link_unknown_body), stringResource(R.string.back), onBack)
                    loadError != null -> EmptyState(Icons.Filled.Warning, stringResource(R.string.lg_form_open_failed), loadError!!, stringResource(R.string.try_again), { tick++ })
                    i == null -> LgLoadingRow()
                    !i.accepting -> EmptyState(Icons.Filled.Schedule, stringResource(R.string.lg_link_closed_title), stringResource(R.string.lg_link_closed_body), stringResource(R.string.back), onBack)
                    sentId != null -> Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.CheckCircle, null, tint = c.success, modifier = Modifier.size(40.dp))
                        Text(stringResource(R.string.lg_request_sent), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(stringResource(R.string.lg_request_sent_body), fontSize = 14.sp, color = c.mutedFg, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(6.dp))
                        NxButton(stringResource(R.string.lg_open_my_submissions), { onOpenMine(sentId!!) }, kind = NxButtonKind.PRIMARY)
                        NxButton(stringResource(R.string.lg_send_another), ::reset)
                    }
                    else -> {
                        val list = LegalLogic.formTemplates(i.templates, companyId)
                        val template = list.firstOrNull { it.id == templateId }
                        Text(i.lockedCompany?.let { stringResource(R.string.lg_request_sub_company, it.name) } ?: stringResource(R.string.lg_request_sub), fontSize = 14.sp, color = c.mutedFg)
                        LgCard {
                            LgFormRow(stringResource(R.string.lg_company), error = errors["companyId"]) {
                                val locked = i.lockedCompany
                                if (locked != null) LgFieldBox(Modifier.fillMaxWidth(), enabled = false, onClick = {}) { Text(locked.name, fontSize = 14.sp, color = c.foreground) }
                                else LgMenuPicker(i.companies.map { it.id to it.name }, companyId, { companyId = it; templateId = null; values.clear() },
                                    placeholder = stringResource(R.string.lg_pick_company))
                            }
                            LgFormRow(stringResource(R.string.lg_document_type), error = errors["templateId"]) {
                                when {
                                    companyId == null -> LgFieldBox(Modifier.fillMaxWidth(), enabled = false, onClick = {}) {
                                        Text(stringResource(R.string.lg_pick_company_first), fontSize = 14.sp, color = c.mutedFg)
                                    }
                                    list.isEmpty() -> Text(stringResource(R.string.lg_no_types_for_company), fontSize = 13.sp, color = c.mutedFg)
                                    else -> LgMenuPicker(list.map { it.id to "${it.name} · ${lgDocType(it.docType)}" }, templateId, { templateId = it; values.clear(); errors = emptyMap() },
                                        placeholder = stringResource(R.string.lg_pick_doc_type))
                                }
                            }
                        }
                        if (template != null) {
                            if (template.description.isNotEmpty()) Text(template.description, fontSize = 13.sp, color = c.mutedFg)
                            if (template.isAddendum) LgCard {
                                LgFormRow(stringResource(R.string.lg_parent_number), required = true, hint = stringResource(R.string.lg_parent_number_hint), error = errors["parentNumber"]) {
                                    LgTextField(parentNumber, { parentNumber = it.uppercase() }, placeholder = stringResource(R.string.lg_parent_number_placeholder), mono = true)
                                }
                            }
                            if (template.fields.isNotEmpty()) LgCard {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(stringResource(R.string.lg_details_for_doc), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                    Text(stringResource(R.string.lg_all_optional), fontSize = 12.sp, color = c.mutedFg)
                                }
                                template.fields.forEach { f ->
                                    // People outside Legal see the label only, not the placeholder's name.
                                    LgFieldInput(f, values[f.name], errors, f.name, hideName = true) { v ->
                                        if (v == null) values.remove(f.name) else values[f.name] = v
                                        errors = errors - f.name
                                    }
                                }
                            }
                        }
                        LgCard {
                            LgFormRow(stringResource(R.string.lg_purpose), hint = stringResource(R.string.lg_purpose_hint)) {
                                LgTextField(purpose, { purpose = it }, singleLine = false, minLines = 3)
                            }
                            LgFormRow(stringResource(R.string.lg_needed_by), error = errors["deadline"]) {
                                LgDayField(deadline, { deadline = it })
                            }
                            LgFormRow(stringResource(R.string.lg_related_project)) {
                                LgLinkButton(link, { link = it }, placeholder = stringResource(R.string.lg_none), own = true)
                            }
                            LgFormRow(stringResource(R.string.lg_attachments), hint = stringResource(R.string.lg_attachments_hint, LegalLogic.MAX_ATTACHMENTS)) {
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    files.forEach { f ->
                                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(start = 12.dp),
                                            verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Filled.Attachment, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
                                            Text(f.name, fontSize = 13.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                            IconButton(onClick = { files = files - f }) { Icon(Icons.Filled.Close, stringResource(R.string.lg_remove_file, f.name), tint = c.mutedFg) }
                                        }
                                    }
                                    if (files.size < LegalLogic.MAX_ATTACHMENTS) NxButton(stringResource(R.string.lg_attach_files), { pick.launch(LegalApi.DOCUMENT_TYPES) },
                                        icon = Icons.Filled.Attachment, compact = true)
                                }
                            }
                        }
                        formError?.let { Text(it, fontSize = 13.sp, color = c.danger) }
                        Box(Modifier.fillMaxWidth()) {
                            NxButton(stringResource(R.string.lg_send_request), { send(i) }, kind = NxButtonKind.PRIMARY, modifier = Modifier.fillMaxWidth(),
                                enabled = !sending && templateId != null && companyId != null && !(template?.isAddendum == true && parentNumber.isBlank()))
                            if (sending) CircularProgressIndicator(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(18.dp), strokeWidth = 2.dp)
                        }
                    }
                }
                Spacer(Modifier.height(60.dp))
            }
        }
    }
}

// ── My requests (My Submissions) ──

/** My Legal requests, above the form submissions board: name, company, stage, deadline, number, reason, download. */
@Composable
fun MyLegalRequestsStrip(requests: List<LgMyRequest>, onOpen: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    val today = LegalLogic.todayJakarta()
    var downloading by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Balance, null, tint = c.mutedFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.lg_legal_requests), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            Spacer(Modifier.width(6.dp))
            Text("${requests.size}", fontSize = 12.sp, color = c.mutedFg)
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            requests.forEach { r ->
                Column(Modifier.width(260.dp).clip(RoundedCornerShape(10.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(10.dp))
                    .clickable { onOpen(r.id) }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Text(r.templateName.ifEmpty { lgDocType(r.docType) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2,
                            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(4.dp))
                        LgStageChip(r.stage)
                    }
                    Text(listOfNotNull(r.company?.name, if (r.isAddendum && r.parentNumberText.isNotEmpty()) stringResource(R.string.lg_amends, r.parentNumberText) else null)
                        .joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.lg_sent_on, lgDate(r.createdAt)), fontSize = 11.sp, color = c.mutedFg)
                        r.deadline?.let { DeadlineLabel(it, LegalLogic.myOverdue(r, today)) }
                    }
                    r.document?.let { Text(it.number, fontSize = 11.sp, fontFamily = LgMono, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    if (r.stage == "REJECTED" && !r.rejectReason.isNullOrEmpty()) Text(r.rejectReason, fontSize = 12.sp, color = c.danger, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (r.canDownload) NxButton(stringResource(if (r.stage == "SIGNED") R.string.lg_download_signed else R.string.lg_download_final), {
                        downloading = r.id
                        scope.launch {
                            try { LegalFiles.share(ctx, api.myRequestFile(r.id)) } catch (e: ApiError) { id.znetworks.nexus.ui.components.UiNotice.show(legalMessage(ctx, e)) }
                            downloading = null
                        }
                    }, icon = Icons.Filled.FileDownload, compact = true, enabled = downloading == null)
                }
            }
        }
    }
}

/** One of my Legal requests: its stage, Legal's reason when declined, the file once final, my answers and files. */
@Composable
fun MyLegalRequestScreen(requestId: String, onBack: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var request by remember { mutableStateOf<LgMyRequest?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var notFound by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    suspend fun load() {
        try { request = api.myRequest(requestId); failure = null; notFound = request == null }
        catch (e: ApiError) { if (e is ApiError.Http && e.status == 404) notFound = true else if (request == null) failure = legalMessage(ctx, e) }
    }
    LaunchedEffect(tick) { load() }
    LiveRefresh(requestId, liveMs = null, fallbackMs = 60_000, matches = { it.name == RealtimeEvents.WORKSPACE_CHANGED && it.kind == "submissions" }) { load() }
    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(request?.templateName?.ifEmpty { null } ?: stringResource(R.string.lg_request_title), onBack = onBack,
                titleContent = { id.znetworks.nexus.feature.projects.ProjectTitle(request?.templateName?.ifEmpty { null } ?: stringResource(R.string.lg_request_title)) })
            val r = request
            when {
                notFound -> EmptyState(Icons.Filled.SearchOff, stringResource(R.string.lg_request_gone), stringResource(R.string.lg_request_gone_body), stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                failure != null && r == null -> EmptyState(Icons.Filled.Warning, stringResource(R.string.lg_details_failed), failure!!, stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
                r == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LgStageChip(r.stage); Spacer(Modifier.width(8.dp))
                        Text("${lgDocType(r.docType)} · ${r.company?.name.orEmpty()}", fontSize = 12.sp, color = c.mutedFg)
                    }
                    r.createdAt?.let { Text(stringResource(R.string.lg_sent_on, lgDate(it)), fontSize = 12.sp, color = c.mutedFg) }
                    if (r.stage == "REJECTED") Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(lgTone("danger").bg).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.lg_declined_mine), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(r.rejectReason ?: "—", fontSize = 14.sp, color = c.foreground)
                    }
                    r.document?.let { d ->
                        LgCard(padding = 14.dp) {
                            Text(d.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text("${d.number} · ${lgStatus(d.status)}", fontSize = 12.sp, fontFamily = LgMono, color = c.mutedFg)
                            if (r.canDownload) NxButton(stringResource(R.string.lg_download), {
                                downloading = true
                                scope.launch {
                                    try { LegalFiles.share(ctx, api.myRequestFile(r.id)) } catch (e: ApiError) { failure = legalMessage(ctx, e) }
                                    downloading = false
                                }
                            }, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.FileDownload, enabled = !downloading)
                            else Text(stringResource(R.string.lg_download_when_final), fontSize = 12.sp, color = c.mutedFg)
                        }
                    }
                    failure?.let { Text(it, fontSize = 13.sp, color = c.danger) }
                    LgCard(padding = 14.dp) {
                        Info(stringResource(R.string.lg_needed_by), lgDay(r.deadline))
                        Info(stringResource(R.string.lg_handled_by), r.pic?.name ?: stringResource(R.string.lg_not_assigned))
                        Info(stringResource(R.string.lg_related_to), r.deal?.let { "${it.code} · ${it.name}" } ?: r.project?.name ?: "—")
                        if (r.isAddendum) Info(stringResource(R.string.lg_parent_number), r.parentNumberText.ifEmpty { "—" })
                        if (r.purpose.isNotEmpty()) Info(stringResource(R.string.lg_purpose), r.purpose)
                    }
                    Text(stringResource(R.string.lg_your_answers), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                    if (r.answers.isEmpty()) Text(stringResource(R.string.lg_you_left_to_legal), fontSize = 14.sp, color = c.mutedFg)
                    else LgCard(padding = 14.dp) {
                        val yes = stringResource(R.string.lg_yes)
                        r.answers.forEach { a -> Info(a.label.ifEmpty { a.name }, LegalLogic.answerText(LgValue.of(a.value), a.type, a.columns, yes, ::lgDay)) }
                    }
                    if (r.attachments.isNotEmpty()) {
                        Text(stringResource(R.string.lg_attachments), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                        r.attachments.forEach { a -> AttachmentRow(a) { api.myRequestAttachment(r.id, a) } }
                    }
                    Spacer(Modifier.height(40.dp))
                }
            }
        }
    }
}
