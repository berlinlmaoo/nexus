package id.znetworks.nexus.feature.legal

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.CalendarMonth
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.CompactSearchField
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PageTab
import id.znetworks.nexus.ui.components.PageTabs
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay

/** Where Legal's screens go: the shell turns each into a route. */
class LegalNav(
    val back: () -> Unit,
    val openDoc: (String) -> Unit,
    /** New document; [parentId] = Create addendum on that signed document; [requestId] = Create document from a request. */
    val newDoc: (parentId: String?, requestId: String?) -> Unit,
    val uploadDoc: () -> Unit,
    val openTemplate: (String) -> Unit,
    val newTemplate: () -> Unit,
    val openRequest: (String) -> Unit,
    val requestLinks: () -> Unit,
    val invite: () -> Unit,
)

/** Runs [block] every time the screen comes back to the front (a sheet or pushed screen closed). */
@Composable
fun OnResume(key: Any? = Unit, block: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, key) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { block() } }
}

/**
 * Legal (owner, 14 Oct 2026; web routes/_app/legal.tsx, iOS LegalView): documents made from templates with automatic
 * numbering, reviewed and versioned, the archive of every legal document, and the requests people send through a link.
 * Five tabs: Documents · Requests · Templates · Companies & numbering · Members. Invitation only: the More entry is
 * drawn when the roster's canAccessLegal is true, and the server refuses every /api/legal call for everyone else, so a
 * link lands on "Legal is by invitation only" here.
 */
@Composable
fun LegalScreen(nav: LegalNav, initialTab: String? = null, focusRequest: String? = null) {
    val api = rememberLegalApi()
    var me by remember { mutableStateOf<LgMe?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var tab by rememberSaveable { mutableStateOf(initialTab?.takeIf { it in TABS } ?: if (focusRequest != null) "requests" else "documents") }
    // A request a notification pointed at (`/legal?tab=requests&request=<id>`): the Requests tab, then its detail,
    // once (saved, so coming back from the detail does not open it again).
    var focusUsed by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(focusRequest, me) {
        if (focusRequest != null && me != null && !focusUsed) { focusUsed = true; tab = "requests"; nav.openRequest(focusRequest) }
    }
    LaunchedEffect(tick) {
        error = null
        try { me = api.me() } catch (e: ApiError) { error = e }
    }
    LgPage {
        Column(Modifier.fillMaxSize()) {
            val tabs = listOf(
                PageTab("documents", stringResource(R.string.lg_tab_documents), icon = Icons.Filled.Inventory2),
                PageTab("requests", stringResource(R.string.lg_tab_requests), icon = Icons.Filled.Inbox),
                PageTab("templates", stringResource(R.string.lg_tab_templates), icon = Icons.Filled.Description),
                PageTab("settings", stringResource(R.string.lg_tab_settings), icon = Icons.Filled.Tune),
                PageTab("members", stringResource(R.string.lg_tab_members), icon = Icons.Filled.People),
            )
            PageHeader(stringResource(R.string.lg_title), subtitle = stringResource(R.string.lg_subtitle), onBack = nav.back,
                tabs = if (me != null) ({ PageTabs(tabs, tab, { tab = it }) }) else null)
            val m = me
            val e = error
            when {
                m == null && e == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                m == null -> LgLoadError(e!!, stringResource(R.string.lg_open_failed), { tick++ }, nav.back, Modifier.fillMaxSize())
                else -> when (tab) {
                    "requests" -> LegalRequestsPane(nav)
                    "templates" -> LegalTemplatesPane(nav)
                    "settings" -> LegalSettingsPane(LegalLogic.canEditSettings(m.invitePower))
                    "members" -> LegalMembersPane(nav)
                    else -> LegalDocumentsPane(nav)
                }
            }
        }
    }
}

private val TABS = setOf("documents", "requests", "templates", "settings", "members")

/**
 * A Legal-member route (a document, a template, the board…): "Legal is by invitation only" for someone the roster says
 * was not invited, unless /api/legal/me says otherwise (invited during this session). The server refuses the rest
 * anyway; a call that does not get through shows the screen, which says why itself.
 */
@Composable
fun LegalOnly(onBack: () -> Unit, content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val viewer = (ctx.applicationContext as id.znetworks.nexus.NexusApplication).container.viewer
    val api = rememberLegalApi()
    val allowed by androidx.compose.runtime.produceState<Boolean?>(if (viewer.canAccessLegal) true else null) {
        if (value == true) return@produceState
        viewer.load()
        value = viewer.canAccessLegal || try { api.me().access } catch (e: ApiError) { !e.legalNotInvited() }
    }
    when (allowed) {
        true -> content()
        null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        false -> LgPage {
            Column(Modifier.fillMaxSize()) {
                PageHeader(stringResource(R.string.lg_title), onBack = onBack)
                LgNotInvited(onBack, Modifier.fillMaxSize())
            }
        }
    }
}

/** A filter row's scroller: pickers side by side, swiped sideways on a phone. */
@Composable
fun LgFilterRow(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically, content = content)
}

// ── Documents (the archive) ──

/**
 * Every legal document, made here or uploaded, searchable by number, title and counterparty and filtered by company,
 * type, status, signed copy, where it came from, date and what it belongs to (web LegalDocuments).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LegalDocumentsPane(nav: LegalNav) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    var text by rememberSaveable { mutableStateOf("") }
    var query by remember { mutableStateOf(LegalLogic.ArchiveQuery()) }
    var page by remember { mutableStateOf<LgDocsPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var companies by remember { mutableStateOf<List<LgCompany>>(emptyList()) }
    var link by remember { mutableStateOf<LgLink?>(null) }
    var dates by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }

    LaunchedEffect(text) {
        if (text.isNotEmpty()) delay(300)
        val q = text.trim()
        if (q != query.q) query = query.copy(q = q, page = 1)
    }
    LaunchedEffect(query, tick) {
        loading = true
        try { page = api.documents(query); error = null }
        catch (e: ApiError) { error = legalMessage(ctx, e); if (page != null) LegalToasts.failure(error!!) }
        loading = false
    }
    LaunchedEffect(Unit) { runCatching { companies = api.companies() } }
    // Back from a document, a new one or an upload: what changed shows here.
    OnResume { tick++ }

    fun set(q: LegalLogic.ArchiveQuery) { query = q.copy(page = 1) }

    PullToRefreshBox(isRefreshing = loading && page != null, onRefresh = { tick++ }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CompactSearchField(text, { text = it }, stringResource(R.string.lg_search_docs), Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NxButton(stringResource(R.string.lg_upload_document), nav.uploadDoc, icon = Icons.Filled.FileUpload, compact = true)
                        NxButton(stringResource(R.string.lg_new_document), { nav.newDoc(null, null) }, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Add, compact = true)
                    }
                }
            }
            item {
                LgFilterRow {
                    LgMenuPicker(companies.map { it.id to it.name }, query.companyId, { set(query.copy(companyId = it)) }, noneLabel = stringResource(R.string.lg_all_companies), compact = true)
                    LgMenuPicker(lgDocTypeOptions(), query.docType, { set(query.copy(docType = it)) }, noneLabel = stringResource(R.string.lg_all_types), compact = true)
                    LgMenuPicker(lgStatusOptions(), query.status, { set(query.copy(status = it)) }, noneLabel = stringResource(R.string.lg_all_statuses), compact = true)
                    LgMenuPicker(listOf("1" to stringResource(R.string.lg_signed_uploaded)), query.signed, { set(query.copy(signed = it)) }, noneLabel = stringResource(R.string.lg_signed_or_not), compact = true)
                    LgMenuPicker(listOf("GENERATED" to stringResource(R.string.lg_made_here), "UPLOADED" to stringResource(R.string.lg_uploaded)), query.source,
                        { set(query.copy(source = it)) }, noneLabel = stringResource(R.string.lg_made_or_uploaded), compact = true)
                    LgFieldBox(onClick = { dates = true }) {
                        Icon(Icons.Filled.CalendarMonth, null, tint = c.mutedFg, modifier = Modifier.padding(end = 2.dp))
                        Text(dateLabel(query.from, query.to), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1)
                    }
                    Box(Modifier.widthIn(max = 260.dp)) {
                        LgLinkButton(link, { v -> link = v; set(query.copy(projectId = v?.projectId, dealId = v?.dealId)) }, placeholder = stringResource(R.string.lg_any_link))
                    }
                    if (query.parentId != null) NxButton(stringResource(R.string.lg_one_chain), { set(query.copy(parentId = null)) }, icon = Icons.Filled.Close, compact = true)
                    if (query.filtered) NxButton(stringResource(R.string.lg_clear_filters), { link = null; query = LegalLogic.ArchiveQuery(q = query.q) },
                        kind = NxButtonKind.GHOST, icon = Icons.Filled.Close, compact = true)
                }
            }
            val p = page
            when {
                p == null && error == null -> item { LgLoadingRow() }
                p == null -> item {
                    EmptyState(Icons.Filled.Inventory2, stringResource(R.string.lg_docs_failed), error!!, stringResource(R.string.try_again), { tick++ })
                }
                p.documents.isEmpty() -> item {
                    val searching = query.q.isNotEmpty() || query.filtered
                    if (searching) EmptyState(Icons.Filled.Description, stringResource(R.string.lg_nothing_matches), stringResource(R.string.lg_try_fewer_filters),
                        stringResource(R.string.lg_clear_filters), { text = ""; link = null; query = LegalLogic.ArchiveQuery() })
                    else EmptyState(Icons.Filled.Description, stringResource(R.string.lg_no_documents), stringResource(R.string.lg_no_documents_body),
                        stringResource(R.string.lg_new_document), { nav.newDoc(null, null) })
                }
                else -> {
                    item {
                        LgListCard(p.documents) { d ->
                            var menu by remember { mutableStateOf(false) }
                            Box {
                                DocRow(d, Modifier.combinedClickable(onClick = { nav.openDoc(d.id) },
                                    onLongClick = { if (d.parent != null || d.addendaCount > 0) menu = true }))
                                DropdownMenu(menu, { menu = false }) {
                                    DropdownMenuItem(text = { Text(stringResource(R.string.lg_show_chain)) }, leadingIcon = { Icon(Icons.Filled.AccountTree, null) },
                                        onClick = { menu = false; set(query.copy(parentId = d.parent?.id ?: d.id)) })
                                }
                            }
                        }
                    }
                    LegalLogic.pageRange(query.page, query.limit, p.total)?.let { (from, to, total) ->
                        item {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(stringResource(R.string.lg_page_range, from, to, total), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                                NxButton(stringResource(R.string.lg_previous), { query = query.copy(page = query.page - 1) }, enabled = query.page > 1, compact = true)
                                NxButton(stringResource(R.string.lg_next), { query = query.copy(page = query.page + 1) }, enabled = query.page * query.limit < total, compact = true)
                            }
                        }
                    }
                }
            }
        }
    }
    if (dates) LgDateRangeDialog(query.from, query.to, onDismiss = { dates = false }) { f, t -> dates = false; set(query.copy(from = f, to = t)) }
}

@Composable
private fun dateLabel(from: String?, to: String?): String = when {
    from == null && to == null -> stringResource(R.string.lg_any_date)
    to == null -> stringResource(R.string.lg_from_day, lgDay(from))
    from == null -> stringResource(R.string.lg_to_day, lgDay(to))
    else -> "${lgDay(from)} – ${lgDay(to)}"
}

/** From / To for the archive (each optional). */
@Composable
private fun LgDateRangeDialog(from: String?, to: String?, onDismiss: () -> Unit, onDone: (String?, String?) -> Unit) {
    var f by remember { mutableStateOf(from) }
    var t by remember { mutableStateOf(to) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.lg_date)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                LgFormRow(stringResource(R.string.lg_from)) { LgDayField(f, { f = it }) }
                LgFormRow(stringResource(R.string.lg_to)) { LgDayField(t, { t = it }) }
            }
        },
        confirmButton = { TextButton(onClick = { onDone(f, t) }) { Text(stringResource(R.string.lg_done)) } },
        dismissButton = { TextButton(onClick = { onDone(null, null) }) { Text(stringResource(R.string.lg_clear)) } })
}

@Composable
private fun docSubtitle(d: LgDocSummary): String {
    val parts = mutableListOf(lgDocType(d.docType))
    if (d.source == "UPLOADED") parts += stringResource(R.string.lg_uploaded)
    d.deal?.let { parts += it.code } ?: d.project?.let { parts += it.name }
    d.parent?.let { parts += stringResource(R.string.lg_addendum_to, it.number) }
    if (d.addendaCount > 0) parts += pluralStringResource(R.plurals.lg_addenda_n, d.addendaCount, d.addendaCount)
    if (d.status == "VOID") d.numberReusedBy?.let { parts += stringResource(R.string.lg_number_reused_by, it.number) }
    d.signedAt?.let { parts += stringResource(R.string.lg_signed_on_by, lgDate(it), d.signedBy?.name ?: "—") }
    return parts.joinToString(" · ")
}

/** One archive row: the number in monospace (struck when given back), title, counterparty · company · date, status. */
@Composable
private fun DocRow(d: LgDocSummary, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(d.number.ifEmpty { stringResource(R.string.lg_no_number) }, fontSize = 12.sp, fontFamily = LgMono, color = c.mutedFg, maxLines = 1,
                overflow = TextOverflow.Ellipsis, textDecoration = if (d.numberReleased) TextDecoration.LineThrough else null, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(6.dp))
            LgStatusChip(d.status)
        }
        Text(d.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOfNotNull(d.counterparty.ifEmpty { null }, d.company?.name, lgDay(d.docDate)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        Text(docSubtitle(d), fontSize = 12.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
