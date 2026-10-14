package id.znetworks.nexus.feature.legal

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Attachment
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.NoteAdd
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.ui.components.CompactSearchField
import id.znetworks.nexus.ui.components.ConfirmDialog
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PendingConfirm
import id.znetworks.nexus.ui.components.Segmented
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Legal → Requests (owner, 14 Oct 2026; web LegalRequests.tsx, iOS LegalRequestViews): the board of what people asked
// Legal for through a request link. To Do / In Progress / Done (on a phone a segmented column switch) or a list, with
// filters. A card follows its document by itself; a long press moves it by hand. Invited members only.

/** Refreshes on the server's `workspace-changed {kind: "legal"}` ping, and every minute while it is away. */
@Composable
private fun LegalLive(key: Any?, refresh: suspend () -> Unit) =
    LiveRefresh(key, liveMs = null, fallbackMs = 60_000, matches = { it.name == RealtimeEvents.WORKSPACE_CHANGED && it.kind == "legal" }, refresh = refresh)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LegalRequestsPane(nav: LegalNav) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf("board") }
    var column by rememberSaveable { mutableStateOf("TODO") }
    var text by rememberSaveable { mutableStateOf("") }
    var query by remember { mutableStateOf(LegalLogic.BoardQuery()) }
    var rows by remember { mutableStateOf<List<LgBoardRequest>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var members by remember { mutableStateOf<List<LgMember>>(emptyList()) }
    var tick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }

    suspend fun load() {
        loading = true
        try { rows = api.board(query); error = null }
        catch (e: ApiError) { error = legalMessage(ctx, e); if (rows != null) LegalToasts.failure(error!!) }
        loading = false
    }
    LaunchedEffect(text) {
        if (text.isNotEmpty()) delay(300)
        val q = text.trim()
        if (q != query.q) query = query.copy(q = q)
    }
    LaunchedEffect(query, tick) { load() }
    LaunchedEffect(Unit) {
        runCatching { companies = api.companies() }
        runCatching { members = api.members().members.filter { it.active } }
    }
    OnResume { tick++ }
    LegalLive(query) { load() }

    fun move(id: String, to: String) {
        // Shown at once; the reload brings the server's word.
        rows = rows?.map { if (it.id == id) it.copy(column = to) else it }
        scope.launch {
            try { api.updateRequest(id, lgBody("column" to to)) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            load()
        }
    }

    PullToRefreshBox(loading && rows != null, { tick++ }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CompactSearchField(text, { text = it }, stringResource(R.string.lg_search_requests), Modifier.fillMaxWidth())
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Segmented(listOf("board" to stringResource(R.string.lg_board), "list" to stringResource(R.string.lg_list)), mode, { mode = it })
                        Spacer(Modifier.weight(1f))
                        NxButton(stringResource(R.string.lg_request_links), nav.requestLinks, icon = Icons.Filled.Link, compact = true)
                    }
                }
            }
            item {
                val types = rows.orEmpty().map { it.docType }.distinct().sorted()
                LgFilterRow {
                    LgMenuPicker(types.map { it to lgDocType(it) }, query.docType, { query = query.copy(docType = it) }, noneLabel = stringResource(R.string.lg_all_types), compact = true)
                    LgMenuPicker(companies.map { it.id to it.name }, query.companyId, { query = query.copy(companyId = it) }, noneLabel = stringResource(R.string.lg_all_companies), compact = true)
                    LgMenuPicker(listOf("none" to stringResource(R.string.lg_no_pic)) + members.map { it.userId to it.shownName }, query.picId, { query = query.copy(picId = it) },
                        noneLabel = stringResource(R.string.lg_any_pic), compact = true)
                    LgMenuPicker(listOf("overdue" to stringResource(R.string.lg_overdue), "week" to stringResource(R.string.lg_due_week), "none" to stringResource(R.string.lg_no_deadline)),
                        query.deadline, { query = query.copy(deadline = it) }, noneLabel = stringResource(R.string.lg_any_deadline), compact = true)
                    if (query.filtered) NxButton(stringResource(R.string.lg_clear_filters), { query = LegalLogic.BoardQuery(q = query.q) }, kind = NxButtonKind.GHOST,
                        icon = Icons.Filled.Close, compact = true)
                }
            }
            val r = rows
            when {
                r == null && error != null -> item { EmptyState(Icons.Filled.Inbox, stringResource(R.string.lg_requests_failed), error!!, stringResource(R.string.try_again), { tick++ }) }
                r == null -> item { LgLoadingRow() }
                r.isEmpty() -> item {
                    val searching = query.q.isNotEmpty() || query.filtered
                    if (searching) EmptyState(Icons.Filled.Inbox, stringResource(R.string.lg_nothing_matches), stringResource(R.string.lg_try_fewer_filters),
                        stringResource(R.string.lg_clear_filters), { text = ""; query = LegalLogic.BoardQuery() })
                    else EmptyState(Icons.Filled.Inbox, stringResource(R.string.lg_no_requests), stringResource(R.string.lg_no_requests_body),
                        stringResource(R.string.lg_request_links), nav.requestLinks)
                }
                mode == "list" -> item {
                    LgListCard(r) { req -> MovableCard(req, ::move) { long -> ListRow(req, Modifier.combinedClickable(onClick = { nav.openRequest(req.id) }, onLongClick = long)) } }
                }
                else -> {
                    val cols = LegalLogic.columns(r)
                    item {
                        Segmented(LegalLogic.BOARD_COLUMNS.map { col -> col to "${lgColumn(col)} ${cols[col].orEmpty().size}" }, column, { column = it }, Modifier.fillMaxWidth())
                    }
                    val shown = cols[column].orEmpty()
                    if (shown.isEmpty()) item {
                        Text(stringResource(R.string.lg_column_empty), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                    items(shown, key = { it.id }) { req ->
                        MovableCard(req, ::move) { long -> RequestCard(req, Modifier.combinedClickable(onClick = { nav.openRequest(req.id) }, onLongClick = long)) }
                    }
                }
            }
        }
    }
}

/** A card with its long-press "Move to …" menu; [content] gets the long-press action. */
@Composable
private fun MovableCard(r: LgBoardRequest, move: (String, String) -> Unit, content: @Composable (onLongPress: () -> Unit) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        content { menu = true }
        DropdownMenu(menu, { menu = false }) {
            LegalLogic.moveTargets(r.column).forEach { col ->
                DropdownMenuItem(text = { Text(stringResource(R.string.lg_move_to, lgColumn(col))) }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.ArrowForward, null) },
                    onClick = { menu = false; move(r.id, col) })
            }
        }
    }
}

/** Card: template name, company, requester, deadline (red when overdue), PIC, document number + status, "Rejected". */
@Composable
private fun RequestCard(r: LgBoardRequest, modifier: Modifier) {
    val c = Nx.colors
    val today = LegalLogic.todayJakarta()
    val overdue = LegalLogic.boardOverdue(r, today)
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(r.templateName.ifEmpty { lgDocType(r.docType) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (r.rejected) LgChip(stringResource(R.string.lg_rejected), lgTone("danger"))
        }
        Text(listOfNotNull(r.company?.name, if (r.isAddendum && r.parentNumberText.isNotEmpty()) stringResource(R.string.lg_amends, r.parentNumberText) else null)
            .joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(r.requester?.name ?: "—", fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            r.deadline?.let { DeadlineLabel(it, overdue) }
            if (r.attachments.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Attachment, null, tint = c.mutedFg, modifier = Modifier.size(12.dp))
                Text("${r.attachments.size}", fontSize = 11.sp, color = c.mutedFg)
            }
        }
        Text(r.pic?.let { "PIC · ${it.name}" } ?: stringResource(R.string.lg_no_pic), fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
        r.document?.let { d ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.number, fontSize = 10.sp, fontFamily = LgMono, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(4.dp))
                LgStatusChip(d.status)
            }
        }
    }
}

@Composable
private fun ListRow(r: LgBoardRequest, modifier: Modifier) {
    val c = Nx.colors
    val overdue = LegalLogic.boardOverdue(r, LegalLogic.todayJakarta())
    Column(modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(r.templateName.ifEmpty { lgDocType(r.docType) }, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (r.rejected) LgChip(stringResource(R.string.lg_rejected), lgTone("danger")) else Text(lgColumn(r.column), fontSize = 12.sp, color = c.mutedFg)
        }
        Text(listOfNotNull(r.requester?.name, r.company?.name, r.pic?.let { "PIC · ${it.name}" }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            r.deadline?.let { DeadlineLabel(it, overdue) }
            r.document?.let { d -> Text(d.number, fontSize = 11.sp, fontFamily = LgMono, color = c.mutedFg, maxLines = 1); LgStatusChip(d.status) }
        }
    }
}

@Composable
fun DeadlineLabel(day: String, overdue: Boolean) {
    val c = Nx.colors
    val color = if (overdue) c.danger else c.mutedFg
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CalendarMonth, null, tint = color, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(3.dp))
        Text(lgDay(day), fontSize = 11.sp, color = color, fontWeight = if (overdue) FontWeight.SemiBold else FontWeight.Normal, maxLines = 1)
    }
}

// ── One request (Legal) ──

/** One request on the board: the requester's answers and files, and what Legal does with it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LegalRequestScreen(requestId: String, onBack: () -> Unit, onOpenDoc: (String) -> Unit, onCreateDoc: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<LgBoardDetail?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var members by remember { mutableStateOf<List<LgMember>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var rejecting by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var pickingParent by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }

    suspend fun load() {
        try { detail = api.boardRequest(requestId); error = null } catch (e: ApiError) { if (detail == null) error = e }
    }
    LaunchedEffect(tick) { load() }
    LaunchedEffect(Unit) { runCatching { members = api.members().members.filter { it.active } } }
    OnResume { load() }
    LegalLive(requestId) { load() }

    fun update(body: kotlinx.serialization.json.JsonObject) {
        busy = true
        scope.launch {
            try { api.updateRequest(requestId, body) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            load(); busy = false
        }
    }

    LgPage {
        Column(Modifier.fillMaxSize()) {
            val r = detail?.request
            PageHeader(r?.templateName?.ifEmpty { null } ?: stringResource(R.string.lg_request), onBack = onBack)
            when {
                r == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                r == null -> LgLoadError(error!!, stringResource(R.string.lg_request_failed), { tick++ }, onBack, Modifier.fillMaxSize())
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(stringResource(R.string.lg_asked_on, r.requester?.name ?: "—", lgDate(r.createdAt)) + " · " + (r.company?.name ?: ""), fontSize = 13.sp, color = c.mutedFg)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        if (r.rejected) LgChip(stringResource(R.string.lg_rejected), lgTone("danger")) else LgChip(lgColumn(r.column), lgTone("neutral"))
                        LgStageChip(r.stage)
                        r.document?.let { d ->
                            Row(Modifier.clickable { onOpenDoc(d.id) }, verticalAlignment = Alignment.CenterVertically) {
                                Text(d.number, fontSize = 11.sp, fontFamily = LgMono, color = c.violetText); Spacer(Modifier.width(4.dp)); LgStatusChip(d.status)
                            }
                        }
                    }
                    if (r.rejected) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(lgTone("danger").bg).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.lg_declined), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(r.rejectReason, fontSize = 14.sp, color = c.foreground)
                        Text(stringResource(R.string.lg_reopen_hint), fontSize = 12.sp, color = c.mutedFg)
                    }
                    LgCard(padding = 14.dp) {
                        LgFormRow(stringResource(R.string.lg_column)) {
                            LgMenuPicker(LegalLogic.BOARD_COLUMNS.map { it to lgColumn(it) }, r.column, { v -> if (v != null && v != r.column) update(lgBody("column" to v)) }, enabled = !busy)
                        }
                        LgFormRow("PIC") {
                            LgMenuPicker(members.map { it.userId to it.shownName }, r.pic?.id, { v -> update(lgBody("picId" to v)) }, noneLabel = stringResource(R.string.lg_no_pic), enabled = !busy)
                        }
                    }
                    if (r.isAddendum) LgCard(padding = 14.dp) {
                        LgFormRow(stringResource(R.string.lg_parent_typed)) {
                            Text(r.parentNumberText.ifEmpty { "—" }, fontSize = 14.sp, fontFamily = LgMono, color = c.foreground)
                        }
                        LgFormRow(stringResource(R.string.lg_parent_signed), hint = stringResource(R.string.lg_parent_hint)) {
                            val label = r.parent?.number?.let { "$it · ${r.parent.title.orEmpty()}" }
                            LgFieldBox(Modifier.fillMaxWidth(), enabled = !LegalLogic.docLive(r), onClick = { pickingParent = true }) {
                                Icon(Icons.Filled.Description, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
                                Text(label ?: stringResource(R.string.lg_pick_signed_doc), fontSize = 14.sp, color = if (label == null) c.mutedFg else c.foreground,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!LegalLogic.docLive(r)) NxButton(stringResource(R.string.lg_create_document), { onCreateDoc(r.id) }, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.NoteAdd,
                            enabled = LegalLogic.canCreateFromRequest(r) && !busy)
                        else r.document?.let { d -> NxButton(stringResource(R.string.lg_open_document), { onOpenDoc(d.id) }, icon = Icons.Filled.Description) }
                        if (LegalLogic.canReject(r)) NxButton(stringResource(R.string.lg_reject), { reason = ""; rejecting = true }, kind = NxButtonKind.DESTRUCTIVE, icon = Icons.Filled.Block)
                    }
                    if (LegalLogic.parentMissing(r) && !LegalLogic.docLive(r) && !r.rejected) Text(stringResource(R.string.lg_pick_parent_first), fontSize = 12.sp, color = c.mutedFg)
                    LgCard(padding = 14.dp) {
                        Info(stringResource(R.string.lg_needed_by), lgDay(r.deadline), danger = LegalLogic.boardOverdue(r, LegalLogic.todayJakarta()))
                        Info(stringResource(R.string.lg_related_to), if (r.linkHidden) stringResource(R.string.lg_project_hidden)
                            else r.deal?.let { "${it.code} · ${it.name}" } ?: r.project?.name ?: "—")
                        if (r.purpose.isNotEmpty()) Info(stringResource(R.string.lg_purpose), r.purpose)
                    }
                    Text(stringResource(R.string.lg_requester_filled), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                    val answered = LegalLogic.answered(r)
                    if (answered.isEmpty()) Text(stringResource(R.string.lg_left_to_legal), fontSize = 14.sp, color = c.mutedFg)
                    else LgCard(padding = 14.dp) {
                        val yes = stringResource(R.string.lg_yes)
                        answered.forEach { f -> Info(f.shownLabel, LegalLogic.answerText(LgValue.of(r.fieldValues[f.name]), f.type, f.columns.orEmpty(), yes, ::lgDay)) }
                    }
                    if (r.attachments.isNotEmpty()) {
                        Text(stringResource(R.string.lg_attachments), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                        r.attachments.forEach { a -> AttachmentRow(a) { api.requestAttachment(r.id, a) } }
                    }
                    Spacer(Modifier.height(40.dp))
                }
            }
        }
    }
    if (pickingParent) {
        LgSignedDocPicker(detail?.request?.parentNumberText.orEmpty(), onDismiss = { pickingParent = false }) { id ->
            pickingParent = false
            update(lgBody("parentDocumentId" to id))
        }
    }
    if (rejecting) AlertDialog(
        onDismissRequest = { rejecting = false },
        title = { Text(stringResource(R.string.lg_reject_q)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.lg_reject_body))
                LgTextField(reason, { reason = it }, placeholder = stringResource(R.string.lg_reason), singleLine = false, minLines = 2)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val t = reason.trim()
                rejecting = false
                scope.launch {
                    try { api.rejectRequest(requestId, t); LegalToasts.success(ctx.getString(R.string.lg_request_declined)) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                    reason = ""; load()
                }
            }, enabled = LegalLogic.rejectReasonOk(reason)) { Text(stringResource(R.string.lg_reject), color = c.danger, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = { rejecting = false; reason = "" }) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun Info(label: String, value: String, danger: Boolean = false) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, fontSize = 12.sp, color = c.mutedFg)
        Text(value, fontSize = 14.sp, color = if (danger) c.danger else c.foreground)
    }
}

/** A file the requester attached: downloaded on tap and handed to a viewer (or the share sheet). */
@Composable
fun AttachmentRow(a: LgAttachment, fetch: suspend () -> java.io.File) {
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    LgFieldBox(Modifier.fillMaxWidth(), enabled = !busy, onClick = {
        busy = true
        scope.launch {
            try { val f = fetch(); if (!LegalFiles.open(ctx, f)) LegalFiles.share(ctx, f) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            busy = false
        }
    }) {
        Icon(Icons.Filled.Attachment, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
        Text(a.fileName.ifEmpty { "file" }, fontSize = 13.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (busy) LgSmallSpinner() else Text(lgBytes(a.size), fontSize = 12.sp, color = c.mutedFg)
    }
}

/** Pick the signed document an addendum request amends (the search starts from the number as typed). */
@Composable
fun LgSignedDocPicker(initial: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    var q by remember { mutableStateOf(initial) }
    var docs by remember { mutableStateOf<List<LgDocSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q) {
        if (q != initial) delay(250)
        try { docs = api.documents(LegalLogic.ArchiveQuery(q = q.trim(), status = "SIGNED", limit = 30)).documents; error = null }
        catch (e: ApiError) { error = legalMessage(ctx, e) }
    }
    LgSearchDialog(stringResource(R.string.lg_parent_signed), q, { q = it }, stringResource(R.string.lg_search_docs), onDismiss) {
        val l = docs
        when {
            error != null -> item { Text(error!!, fontSize = 13.sp, color = c.danger, modifier = Modifier.padding(16.dp)) }
            l == null -> item { Box(Modifier.padding(horizontal = 16.dp)) { LgLoadingRow() } }
            l.isEmpty() -> item { Text(stringResource(R.string.lg_no_signed_match), fontSize = 14.sp, color = c.mutedFg, modifier = Modifier.padding(16.dp)) }
            else -> items(l, key = { it.id }) { d -> LgDialogRow(null, d.number, "${d.title} · ${d.company?.name.orEmpty()}") { onPick(d.id) } }
        }
    }
}

// ── Request links ──

/** The request links: the general one and one per company. Copy, open / close for new requests, regenerate. */
@Composable
fun LegalRequestLinksScreen(onBack: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var links by remember { mutableStateOf<List<LgRequestLink>?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var confirm by remember { mutableStateOf<PendingConfirm?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    suspend fun load() { try { links = api.requestLinks(); error = null } catch (e: ApiError) { error = e } }
    LaunchedEffect(tick) { load() }
    fun url(l: LgRequestLink) = NexusConfig.base.trimEnd('/') + l.path
    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(R.string.lg_request_links), onBack = onBack)
            val l = links
            when {
                l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                l == null -> LgLoadError(error!!, stringResource(R.string.lg_links_failed), { tick++ }, onBack, Modifier.fillMaxSize())
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item { Text(stringResource(R.string.lg_links_body), fontSize = 13.sp, color = c.mutedFg) }
                    if (l.isEmpty()) item {
                        EmptyState(Icons.Filled.Link, stringResource(R.string.lg_no_links), stringResource(R.string.lg_no_links_body), stringResource(R.string.lg_reload), { tick++ })
                    }
                    items(l, key = { it.scope }) { link ->
                        LgCard(padding = 14.dp) {
                            Text(link.company?.name ?: stringResource(R.string.lg_link_general), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text(url(link), fontSize = 12.sp, fontFamily = LgMono, color = if (link.accepting) c.foreground else c.mutedFg,
                                textDecoration = if (link.accepting) null else TextDecoration.LineThrough)
                            LgToggle(stringResource(R.string.lg_taking_requests), link.accepting, { v ->
                                scope.launch {
                                    try {
                                        api.setLinkAccepting(link.scope, v)
                                        LegalToasts.success(ctx.getString(if (v) R.string.lg_link_open else R.string.lg_link_closed))
                                    } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                    load()
                                }
                            }, Modifier.fillMaxWidth())
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                NxButton(stringResource(R.string.lg_copy), {
                                    val cm = ctx.getSystemService(android.content.ClipboardManager::class.java)
                                    cm?.setPrimaryClip(android.content.ClipData.newPlainText("link", url(link)))
                                    LegalToasts.success(ctx.getString(R.string.lg_link_copied))
                                }, icon = Icons.Filled.ContentCopy, compact = true)
                                NxButton(stringResource(R.string.lg_regenerate), {
                                    confirm = PendingConfirm(ctx.getString(R.string.lg_regenerate_q), ctx.getString(R.string.lg_regenerate_body), ctx.getString(R.string.lg_regenerate_action)) {
                                        scope.launch {
                                            try { api.regenerateLink(link.scope); LegalToasts.success(ctx.getString(R.string.lg_link_regenerated)) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                            load()
                                        }
                                    }
                                }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Refresh, compact = true)
                            }
                            link.rotatedAt?.let { Text(stringResource(R.string.lg_regenerated_on, lgDate(it)), fontSize = 12.sp, color = c.mutedFg) }
                        }
                    }
                }
            }
        }
    }
    ConfirmDialog(confirm) { confirm = null }
}
