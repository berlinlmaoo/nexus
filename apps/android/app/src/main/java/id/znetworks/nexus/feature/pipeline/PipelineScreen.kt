package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.ui.components.NxTextField

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.material.icons.filled.Warning
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Download

import androidx.compose.material.icons.filled.Lock

import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton

import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.components.WordBoundaryText
import id.znetworks.nexus.ui.components.WordBoundaryLayout
import id.znetworks.nexus.ui.components.rememberWordMeasure
import id.znetworks.nexus.feature.projects.ProjectTitle
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class PipelineState(
    val data: PipelineData? = null,
    val loading: Boolean = true,
    /** 403: the pipeline is for its project members. */
    val forbidden: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val busy: Boolean = false,
    /** The board project's members: who the BD / PM pickers offer (§11.1). */
    val people: List<PipelinePerson> = emptyList(),
    val openDealId: String? = null,
    /** Files on their way to a deal (§13.1): name and progress 0…1, per deal. */
    val uploads: List<PipelineUpload> = emptyList(),
    val year: Int? = null,
    val source: String? = null,
)

data class PipelineUpload(val key: String, val dealId: String, val name: String, val progress: Float)

class PipelineViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    val combined: Boolean = projectId == ALL_PIPELINES_ID
    private val c = (app as NexusApplication).container
    val api = PipelineApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(PipelineState())
    val state = _state.asStateFlow()
    private var loadNumber = 0L

    init { load() }

    /** A reload keeps what is on screen; only a first load says it failed. */
    fun load() = viewModelScope.launch {
        val request = ++loadNumber
        val filter = _state.value
        try {
            val d = if (combined) {
                // A role alone never exposes combined data; the boards route must also allow it.
                val access = PipelineAllAccess.load(c.api, c.viewer)
                if (access == null) {
                    if (request == loadNumber) _state.update { it.copy(data = null, loading = false, forbidden = true) }
                    return@launch
                }
                api.all(access.workspaceId, filter.source, filter.year)
            } else api.load(projectId, filter.year)
            if (request != loadNumber) return@launch
            _state.update { it.copy(data = d, loading = false, error = null, forbidden = false) }
            if (!combined && _state.value.people.isEmpty()) people()
        } catch (e: ApiError) {
            if (request != loadNumber) return@launch
            val h = e as? ApiError.Http
            if (combined && h?.status == 403) PipelineAllAccess.hide()
            _state.update {
                val filterFailed = it.data != null && (filter.year != it.data.year || filter.source != it.data.source)
                it.copy(data = if (h?.status == 403) null else it.data, loading = false, forbidden = h?.status == 403,
                    year = if (filterFailed) it.data?.year else it.year, source = if (filterFailed) it.data?.source else it.source,
                    notice = if (filterFailed) e.describe(res) else it.notice, error = if (it.data == null) e.describe(res) else null)
            }
        }
    }

    fun selectYear(year: Int?) { _state.update { it.copy(year = year) }; load() }
    fun selectSource(source: String?) { if (combined) { _state.update { it.copy(source = source) }; load() } }

    private var peopleAt = 0L

    companion object {
        @Volatile private var membersChangedAt = 0L
        /** Project settings added people: the BD / PM pickers read the members again on the next open. */
        fun membersChanged() { membersChangedAt = System.currentTimeMillis() }
    }

    /** Read fresh when a deal opens (at most once a minute), so someone the lead just added is offered at once. */
    private fun people() = viewModelScope.launch {
        peopleAt = System.currentTimeMillis()
        runCatching { api.people(projectId) }.getOrNull()?.let { p -> _state.update { it.copy(people = p) } }
    }

    fun open(id: String?) {
        _state.update { it.copy(openDealId = id) }
        if (!combined && id != null && (System.currentTimeMillis() - peopleAt > 60_000 || membersChangedAt >= peopleAt)) people()
    }
    fun dismiss() = _state.update { it.copy(notice = null) }

    /** New deal (optionally in a stage); opens it. */
    fun create(stage: String? = null) = viewModelScope.launch {
        if (combined || _state.value.data?.canEdit != true || _state.value.busy) return@launch
        _state.update { it.copy(busy = true) }
        try {
            val d = api.create(projectId, JsonObject(stage?.let { mapOf("stage" to JsonPrimitive(it)) } ?: emptyMap()))
            _state.update { s -> s.copy(data = s.data?.copy(deals = s.data.deals + d), openDealId = d.id) }
            load()
        } catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.pl_create_failed)) } }
        _state.update { it.copy(busy = false) }
    }

    /**
     * One edit: shown at once, then the server's deal (its derived health, phases, overdue); on a refusal the
     * deal goes back and the server's sentence (INVALID_FIELD names the field) or ours is shown.
     */
    fun update(dealId: String, fields: JsonObject, onDone: (PipelineDeal?) -> Unit = {}) {
        if (combined || _state.value.data?.canEdit != true) { onDone(null); return }
        val before = _state.value.data?.deals?.firstOrNull { it.id == dealId }
        replace(dealId) { it.with(fields) }
        viewModelScope.launch {
            try {
                val d = api.update(projectId, dealId, fields)
                replace(dealId) { d }; onDone(d); load() // KPIs come from the server
            } catch (e: ApiError) {
                before?.let { b -> replace(dealId) { b } }
                val h = e as? ApiError.Http
                // A refused cost list (too many lines, a bad amount or description) gets our sentence, in the app's language.
                _state.update { it.copy(notice = if (h?.code == "INVALID_FIELD" && fields.containsKey("costs")) res.getString(R.string.pc_invalid)
                    else h?.serverMessage ?: res.getString(R.string.pl_save_failed)) }
                onDone(null)
            }
        }
    }

    /**
     * Real cost lines (§ Control Tower v4): [edit] runs on the deal as it is NOW (a line saved a moment ago may not have
     * been drawn yet), and the whole list goes in one PATCH like any other field. Nothing is sent when nothing changed.
     */
    fun editCosts(dealId: String, edit: (List<PipelineCost>) -> List<PipelineCost>?) {
        val now = _state.value.data?.deals?.firstOrNull { it.id == dealId } ?: return
        val next = edit(now.costs) ?: return
        if (next == now.costs) return
        if (!PipelineCosts.valid(next)) { _state.update { it.copy(notice = res.getString(R.string.pc_invalid)) }; return }
        update(dealId, PipelineCosts.patch(next, now.costs))
    }

    /** Make (or find) the won deal's execution folder (§15), then open it; an answer without a folder opens the project. */
    fun execution(deal: PipelineDeal, onOpenFolder: (String) -> Unit, onOpenProject: (String) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            val r = api.execution(projectId, deal.id)
            r.deal?.let { d -> replace(d.id) { d } }
            load()
            // The folder and project lists refetch on their own from the server's workspace-changed event.
            r.folderId?.let(onOpenFolder) ?: r.projectId?.let(onOpenProject)
        } catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.pl_exec_failed)) } }
        _state.update { it.copy(busy = false) }
    }

    fun delete(deal: PipelineDeal) = viewModelScope.launch {
        try {
            api.delete(projectId, deal.id)
            _state.update { s -> s.copy(data = s.data?.copy(deals = s.data.deals.filterNot { it.id == deal.id }), openDealId = null,
                notice = res.getString(R.string.pl_deleted, deal.name.ifBlank { res.getString(R.string.pl_untitled) })) }
            load()
        } catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.pl_delete_failed)) } }
    }

    fun export(lang: String, onFile: (java.io.File) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            val dir = java.io.File(getApplication<Application>().cacheDir, "shared/pipeline")
            val filter = _state.value
            onFile(if (combined) api.exportAll(lang, dir, filter.data?.workspaceId, filter.source, filter.year)
                else api.export(projectId, lang, dir, filter.year))
        }
        catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.pl_export_failed)) } }
        _state.update { it.copy(busy = false) }
    }

    // Payment terms (§11.2): every answer carries the whole deal (receivable, health), which replaces ours.
    private fun term(failed: Int, call: suspend () -> PipelineDeal?, onDone: (Boolean) -> Unit = {}) = viewModelScope.launch {
        try {
            call()?.let { d -> replace(d.id) { d } }
            onDone(true); load() // KPIs come from the server
        } catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(notice = when (h?.code) {
                "TOO_MANY_TERMS" -> res.getString(R.string.pl_t_too_many)
                "INVALID_FIELD" -> h.serverMessage ?: res.getString(R.string.pl_save_failed)
                else -> res.getString(failed)
            }) }
            onDone(false)
        }
    }

    private val termRequests = mutableMapOf<String, String>()
    fun addTerm(dealId: String, fields: JsonObject, onDone: (Boolean) -> Unit = {}) = term(R.string.pl_t_add_failed, {
        val key = dealId + fields.toString()
        val id = termRequests.getOrPut(key) { java.util.UUID.randomUUID().toString() }
        api.addTerm(projectId, dealId, JsonObject(fields + ("clientRequestId" to JsonPrimitive(id)))).also { termRequests.remove(key) }
    }, onDone)
    fun updateTerm(dealId: String, termId: String, fields: JsonObject, onDone: (Boolean) -> Unit = {}) =
        term(R.string.pl_save_failed, { api.updateTerm(projectId, dealId, termId, fields) }, onDone)
    fun deleteTerm(dealId: String, termId: String) = term(R.string.pl_t_delete_failed, { api.deleteTerm(projectId, dealId, termId) })

    /** Item answers carry the entire deal, including the server's budget usage and derived totals. */
    private val itemLock = Mutex()
    private fun item(call: suspend () -> PipelineDeal?) = viewModelScope.launch {
        itemLock.withLock {
            if (combined || _state.value.data?.canEdit != true) return@withLock
            _state.update { it.copy(busy = true) }
            try {
                call()?.let { d -> replace(d.id) { d } }
                load()
            } catch (e: ApiError) {
                val h = e as? ApiError.Http
                _state.update { it.copy(notice = if (h?.code == "TOO_MANY_ITEMS") res.getString(R.string.pb8_item_too_many)
                    else h?.serverMessage ?: res.getString(R.string.pl_save_failed)) }
            } finally { _state.update { it.copy(busy = false) } }
        }
    }

    fun addItem(dealId: String, kind: String) {
        if (_state.value.busy) return
        val requestId = java.util.UUID.randomUUID().toString()
        item { api.addItem(projectId, dealId, kind, clientRequestId = requestId) }
    }
    fun updateItem(dealId: String, itemId: String, fields: JsonObject) =
        item { api.updateItem(projectId, dealId, itemId, fields) }
    fun deleteItem(dealId: String, itemId: String) = item {
        val deal = _state.value.data?.deals?.firstOrNull { it.id == dealId }
        val name = (deal?.cashback.orEmpty() + deal?.contacts.orEmpty() + deal?.budgets.orEmpty()).firstOrNull { it.id == itemId }?.name.orEmpty()
        api.deleteItem(projectId, dealId, itemId).also {
            _state.update { s -> s.copy(notice = res.getString(R.string.pb8_item_deleted, name.ifBlank { res.getString(R.string.pl_untitled) })) }
        }
    }

    // Documents (§13.1): files go up on the shared chunk route; the last chunk answers the deal, which replaces ours.
    fun attach(dealId: String, uri: android.net.Uri, docType: String, label: String) = viewModelScope.launch {
        val f = c.uploads.describe(uri) ?: run { _state.update { it.copy(notice = res.getString(R.string.pl_doc_failed, "")) }; return@launch }
        if (f.size > id.znetworks.nexus.core.net.Uploads.MAX_FILE) { _state.update { it.copy(notice = res.getString(R.string.pl_doc_too_big, f.name)) }; return@launch }
        val key = "u${System.nanoTime()}"
        _state.update { it.copy(uploads = it.uploads + PipelineUpload(key, dealId, f.name, 0f)) }
        try {
            val o = c.uploads.chunkedOnly(f, listOfNotNull("target" to "pipeline", "projectId" to projectId, "dealId" to dealId, "docType" to docType, "mime" to f.mime,
                label.trim().takeIf { it.isNotEmpty() }?.let { "label" to it }), JsonObject.serializer()) { done, total ->
                val p = if (total > 0) done.toFloat() / total else 0f
                _state.update { s -> s.copy(uploads = s.uploads.map { if (it.key == key) it.copy(progress = p) else it }) }
            }
            (o["deal"] as? JsonObject)?.let(::PipelineDeal)?.let { d -> replace(d.id) { d } } ?: load()
        } catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(notice = when {
                h?.code == "TOO_MANY_DOCUMENTS" -> res.getString(R.string.pl_doc_too_many)
                h?.status == 404 -> res.getString(R.string.pl_doc_deal_gone)
                else -> res.getString(R.string.pl_doc_failed, f.name)
            }) }
        }
        _state.update { s -> s.copy(uploads = s.uploads.filterNot { it.key == key }) }
    }

    fun removeDocument(dealId: String, docId: String) = viewModelScope.launch {
        try { api.removeDocument(projectId, dealId, docId)?.let { d -> replace(d.id) { d } } ?: load() }
        catch (e: ApiError) { _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.pl_save_failed)) } }
    }

    private fun replace(id: String, f: (PipelineDeal) -> PipelineDeal) =
        _state.update { s -> s.copy(data = s.data?.copy(deals = s.data.deals.map { if (it.id == id) f(it) else it })) }
}

private enum class PipelineView { BOARD, LIST, HEALTH }

/** A colour per health key (the GM's red / amber / green; grey for not started and lost). */
@Composable
internal fun healthColor(key: String): Color = when (key) {
    "CRITICAL" -> Nx.colors.danger; "ATTENTION" -> Nx.colors.warning; "HEALTHY" -> Nx.colors.success; else -> Nx.colors.mutedFg
}

@Composable
internal fun stageLabel(k: String) = PipelineText.stage(k)?.let { stringResource(it) } ?: k

@Composable
internal fun reasonText(r: PipelineReason): String = when (val w = PipelineText.reason(r)) {
    is PipelineText.Words.Str -> if (w.arg != null) stringResource(w.res, w.arg) else stringResource(w.res)
    is PipelineText.Words.Plural -> pluralStringResource(w.res, w.n, w.n)
    is PipelineText.Words.Raw -> w.text
}

@Composable
internal fun HealthPill(key: String) {
    val col = healthColor(key)
    Text(stringResource(PipelineText.health(key)), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = col, maxLines = 1,
        modifier = Modifier.background(col.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
}

/** Six segments: commercial … closing, each done / active / pending / bad (TalkBack reads them). Active is amber (§14.2). */
@Composable
internal fun PhaseTrack(phases: List<PipelinePhase>, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val words = phases.joinToString(", ") { p ->
        (PipelineText.phase(p.key)?.let { r -> res.getString(r) } ?: p.key) + " " + res.getString(when (p.state) { "done" -> R.string.pl_st_done; "active" -> R.string.pl_st_active; "bad" -> R.string.pl_st_bad; else -> R.string.pl_st_pending })
    }
    val label = stringResource(R.string.pl_phase_progress) + ": " + words
    Row(modifier.semantics { contentDescription = label }, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        phases.forEach { p -> Box(Modifier.weight(1f).height(5.dp).background(phaseColor(p.state), RoundedCornerShape(3.dp))) }
    }
}

@Composable
internal fun phaseColor(state: String): Color = when (state) { "done" -> Nx.colors.success; "active" -> Nx.colors.warning; "bad" -> Nx.colors.danger; else -> Nx.colors.muted }

@Composable
internal fun phaseDetailText(d: PipelineDeal, key: String): String = when (val w = PipelineText.phaseDetail(d, key)) {
    is PipelineText.Words.Str -> stringResource(w.res)
    is PipelineText.Words.Plural -> pluralStringResource(w.res, w.n, w.n)
    is PipelineText.Words.Raw -> w.text
}

/** The blocker, written out, on the card and the deal (§14.2/14.3): red when Critical, else amber. */
@Composable
internal fun BlockerBanner(text: String, critical: Boolean, maxLines: Int = Int.MAX_VALUE) {
    val col = if (critical) Nx.colors.danger else Nx.colors.warning
    Row(Modifier.fillMaxWidth().background(col.copy(alpha = 0.12f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Warning, null, tint = col, modifier = Modifier.size(14.dp).padding(top = 1.dp)); Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = col, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
    }
}

/** The stage as a chip: a dot in its group's colour + its label (deal header, §14.3). */
@Composable
internal fun StageChip(stage: String) {
    val c = Nx.colors
    Row(Modifier.background(c.muted, RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(groupTone(stage), CircleShape)); Spacer(Modifier.width(5.dp))
        Text(stageLabel(stage), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A Pipeline Dashboard project's main tab (PIPELINE-DASHBOARD §8): KPIs from the server's summary, search and
 * PM / BD / health filters, and Board · List · Health. Deals open in their own sheet; every edit is live for
 * the others through `pipeline-changed` on the project room the board screen already sits in.
 */
@Composable
fun PipelineTab(newDealRequest: Int, onOpenProject: (String) -> Unit = {}, onOpenFolder: (String) -> Unit = {}, vm: PipelineViewModel = viewModel(), presentation: Boolean = false) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    var q by rememberSaveable { mutableStateOf("") }
    var pm by rememberSaveable { mutableStateOf<String?>(null) }
    var bd by rememberSaveable { mutableStateOf<String?>(null) }
    var health by rememberSaveable { mutableStateOf<String?>(null) }
    var service by rememberSaveable { mutableStateOf<String?>(null) }
    var view by rememberSaveable { mutableStateOf(PipelineView.BOARD) }
    var seenRequest by rememberSaveable { mutableStateOf(newDealRequest) }
    LaunchedEffect(newDealRequest) { if (newDealRequest != seenRequest) { seenRequest = newDealRequest; vm.create() } }
    LiveRefresh(vm.projectId, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == RealtimeEvents.PIPELINE_CHANGED && (it.projectId == null ||
            if (vm.combined) s.data?.boards.orEmpty().any { board -> board.id == it.projectId } else it.projectId == vm.projectId) }) { vm.load().join() }

    val d = s.data
    if (vm.combined) d?.boards.orEmpty().forEach { board ->
        androidx.compose.runtime.key(board.id) { id.znetworks.nexus.core.realtime.RealtimeRoom("project:${board.id}") }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalPipelinePresentation provides presentation) {
    when {
        s.loading && d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Text(stringResource(R.string.pl_loading), fontSize = 12.sp, color = c.mutedFg) }
        }
        s.forbidden && d == null -> EmptyState(Icons.Filled.Lock,
            stringResource(if (vm.combined) R.string.pb8_forbidden else R.string.pl_forbidden), stringResource(R.string.pl_forbidden_sub), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        d == null -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pl_load_failed), stringResource(R.string.pl_load_failed_sub), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        else -> Column(Modifier.fillMaxSize()) {
            Kpis(d.summary)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (vm.combined) BoardFilter(stringResource(R.string.pb8_company), stringResource(R.string.pb8_all_companies),
                    d.boards.map { it.id to it.name }, s.source, vm::selectSource)
                BoardFilter(stringResource(R.string.pb8_year), stringResource(R.string.pb8_all_years),
                    d.years.map { it.toString() to it.toString() }, s.year?.toString(), { vm.selectYear(it?.toIntOrNull()) })
            }
            // Header (§12.3): search full width + one menu (PM ›, BD ›, clear, Excel), the views, health chips on their own row.
            val pms = d.deals.mapNotNull { x -> (x.pmUserId ?: x.pmShown)?.let { it to (x.pmShown ?: "—") } }.distinct().sortedBy { it.second.lowercase() }
            val bds = d.deals.mapNotNull { x -> (x.bdUserId ?: x.bdShown)?.let { it to (x.bdShown ?: "—") } }.distinct().sortedBy { it.second.lowercase() }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                NxTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.pl_search_hint), maxLines = 1) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f))
                // "Filter by service" only when the board uses more than one (§13.2).
                val services = PipelineFilter.services(d.deals).takeIf { it.size > 1 }.orEmpty()
                FiltersMenu(pms, bds, services.map { it to it }, pm, bd, service, s.busy, onPm = { pm = it }, onBd = { bd = it }, onService = { service = it }, onExport = {
                    vm.export(if (java.util.Locale.getDefault().language.let { it == "in" || it == "id" }) "id" else "en") { f ->
                        runCatching {
                            val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                            context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND)
                                .setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    }
                })
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
                listOf(PipelineView.BOARD to R.string.ptab_board, PipelineView.LIST to R.string.ptab_list, PipelineView.HEALTH to R.string.pl_health).forEachIndexed { i, (v, l) ->
                    SegmentedButton(view == v, { view = v }, SegmentedButtonDefaults.itemShape(i, 3),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.border), icon = {}) { Text(stringResource(l)) }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                // An active PM / BD filter shows here, tap to drop it.
                pms.firstOrNull { it.first == pm }?.let { (_, n) -> FilterChip(true, { pm = null }, { Text("PM: $n") }, trailingIcon = { Icon(Icons.Filled.Close, null, Modifier.size(14.dp)) }) }
                bds.firstOrNull { it.first == bd }?.let { (_, n) -> FilterChip(true, { bd = null }, { Text("BD: $n") }, trailingIcon = { Icon(Icons.Filled.Close, null, Modifier.size(14.dp)) }) }
                service?.let { n -> FilterChip(true, { service = null }, { Text(n) }, trailingIcon = { Icon(Icons.Filled.Close, null, Modifier.size(14.dp)) }) }
                listOf(null, "CRITICAL", "ATTENTION", "HEALTHY", "NOT_STARTED").forEach { k ->
                    FilterChip(health == k, { health = k }, { Text(if (k == null) stringResource(R.string.tk_all) else stringResource(PipelineText.health(k))) })
                }
            }
            val shown = PipelineFilter.apply(d.deals, q, pm, bd, health, service)
            if (shown.size != d.deals.size) Text(stringResource(R.string.pl_shown_of, shown.size, d.deals.size), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
            Box(Modifier.weight(1f)) {
                if (d.deals.isEmpty() && s.year == null && s.source == null) {
                    if (vm.combined) EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pb8_empty), stringResource(R.string.pb8_combined_subtitle),
                        stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                    else EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pl_empty), stringResource(R.string.pl_empty_sub),
                        stringResource(if (d.canEdit && !presentation) R.string.pl_add_first else R.string.try_again),
                        { if (d.canEdit && !presentation) vm.create() else vm.load() }, Modifier.fillMaxSize())
                }
                else if (shown.isEmpty()) EmptyState(Icons.Filled.Search, stringResource(R.string.pl_no_match),
                    pluralStringResource(R.plurals.pl_filters_hide, d.deals.size, d.deals.size), stringResource(R.string.clear_search),
                    { q = ""; pm = null; bd = null; health = null; service = null; vm.selectYear(null); vm.selectSource(null) }, Modifier.fillMaxSize())
                else when (view) {
                    PipelineView.BOARD -> Board(shown, d, vm)
                    PipelineView.LIST -> ByStage(shown, d, vm)
                    PipelineView.HEALTH -> HealthView(shown, d, vm)
                }
            }
        }
    }
    s.openDealId?.let { id -> d?.deals?.firstOrNull { it.id == id }?.let { deal ->
        if (vm.combined) deal.source?.let { source ->
            SourceDealSheet(deal.id, source, onOpenProject, onOpenFolder) { vm.open(null); vm.load() }
        }
        else DealSheet(deal, d, s.people, vm, onOpenProject = { pid -> vm.open(null); onOpenProject(pid) }, onOpenFolder = { fid -> vm.open(null); onOpenFolder(fid) }) { vm.open(null) }
    } }
    s.notice?.let { androidx.compose.material3.AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
    }
}

/** Company and year are the only view filters that ask the server for a matching KPI summary. */
@Composable
private fun BoardFilter(label: String, all: String, options: List<Pair<String, String>>, selected: String?, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        FilterChip(selected != null, { open = true }, { Text(options.firstOrNull { it.first == selected }?.second ?: selected ?: all) },
            trailingIcon = { Icon(Icons.Filled.KeyboardArrowDown, label, Modifier.size(18.dp)) })
        DropdownMenu(open, { open = false }) {
            Text(label, fontSize = 11.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            DropdownMenuItem({ Text(all, fontWeight = if (selected == null) FontWeight.Bold else null) }, { open = false; onSelect(null) })
            options.forEach { (id, name) -> DropdownMenuItem({ Text(name, fontWeight = if (id == selected) FontWeight.Bold else null) }, { open = false; onSelect(id) }) }
        }
    }
}

/** One icon menu: Filter by PM ›, Filter by BD ›, Clear filters, Download Excel (a sub-list replaces the menu's items). */
@Composable
private fun FiltersMenu(pms: List<Pair<String, String>>, bds: List<Pair<String, String>>, services: List<Pair<String, String>>, pm: String?, bd: String?, service: String?,
                        busy: Boolean, onPm: (String?) -> Unit, onBd: (String?) -> Unit, onService: (String?) -> Unit, onExport: () -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    var level by remember { mutableStateOf<String?>(null) }
    Box {
        IconButton(onClick = { level = null; open = true }, enabled = !busy) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Icon(Icons.Filled.FilterList, stringResource(R.string.pl_filters_export), tint = if (pm != null || bd != null || service != null) c.violetText else c.mutedFg)
        }
        DropdownMenu(open, { open = false }) {
            when (level) {
                null -> {
                    DropdownMenuItem(text = { Text(stringResource(R.string.pl_filter_pm)) }, onClick = { level = "pm" }, trailingIcon = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.pl_filter_bd)) }, onClick = { level = "bd" }, trailingIcon = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) })
                    if (services.isNotEmpty()) DropdownMenuItem(text = { Text(stringResource(R.string.pl_filter_service)) }, onClick = { level = "service" },
                        trailingIcon = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.pl_clear_filters)) }, enabled = pm != null || bd != null || service != null,
                        onClick = { open = false; onPm(null); onBd(null); onService(null) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.pl_export)) }, leadingIcon = { Icon(Icons.Filled.Download, null) }, onClick = { open = false; onExport() })
                }
                else -> {
                    val (list, cur, pick, all) = when (level) {
                        "pm" -> Quad(pms, pm, onPm, R.string.pl_all_pm); "bd" -> Quad(bds, bd, onBd, R.string.pl_all_bd)
                        else -> Quad(services, service, onService, R.string.pl_all_services)
                    }
                    DropdownMenuItem(text = { Text(stringResource(all), fontWeight = if (cur == null) FontWeight.Bold else null) }, onClick = { open = false; pick(null) })
                    list.forEach { (id, name) -> DropdownMenuItem(text = { Text(name, fontWeight = if (cur == id) FontWeight.Bold else null) }, onClick = { open = false; pick(id) }) }
                }
            }
        }
    }
}

private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

/** The KPI strip over every deal (§12.3): small chips sideways on a phone, one card of equal tiles on a tablet; a zero is muted. */
@Composable
internal fun Kpis(sm: PipelineSummary) {
    val c = Nx.colors
    data class Tile(val label: String, val value: String, val sub: String, val zero: Boolean, val tone: Color? = null, val detail: String? = null, val warn: String? = null)
    val overdue = sm.n("receivableOverdue")
    val profit = sm.n("realProfit")
    val noNet = sm.i("costNoNetCount")
    val tiles = listOf(
        Tile(stringResource(R.string.pl_k_open), pipelineMoney(sm.n("openValue")), pluralStringResource(R.plurals.pl_k_in_play, sm.i("openCount"), sm.i("openCount")), sm.n("openValue") == 0.0),
        Tile(stringResource(R.string.pl_k_weighted), pipelineMoney(sm.n("weightedValue")), stringResource(R.string.pl_k_weighted_sub), sm.n("weightedValue") == 0.0),
        Tile(stringResource(R.string.pl_k_won), pipelineMoney(sm.n("wonValue")), stringResource(R.string.pl_k_won_sub, sm.i("activeCount"), sm.i("lostCount")), sm.n("wonValue") == 0.0),
        Tile(stringResource(R.string.pl_k_receivable), pipelineMoney(sm.n("receivable")),
            if (overdue > 0) stringResource(R.string.pl_k_overdue, pipelineMoney(overdue)) else stringResource(R.string.pl_k_nothing_overdue), sm.n("receivable") == 0.0),
        // Control Tower v6 (14 Oct 2026): Σ (net value − real cost) of the deals not Lost with costs and a net value, red
        // below zero; under it the real cost of the same deals. Deals with costs but no net value are left out, named in amber.
        Tile(stringResource(R.string.pc_k_real_profit), pipelineMoney(profit),
            pluralStringResource(R.plurals.pc_k_have_costs, sm.i("costEligibleCount"), sm.i("costDealCount"), sm.i("costEligibleCount")), profit == 0.0,
            tone = if (profit < 0) c.danger else null, detail = stringResource(R.string.pc_k_real_cost, pipelineMoney(sm.n("realCost"))),
            warn = if (noNet > 0) pluralStringResource(R.plurals.pc_k_no_net, noNet, noNet) else null),
        Tile(stringResource(R.string.pl_critical), "${sm.i("criticalCount")}", stringResource(R.string.pl_k_attention, sm.i("attentionCount")), sm.i("criticalCount") == 0),
        Tile(stringResource(R.string.pl_k_ready), "${sm.i("readyCount")}", stringResource(R.string.pl_k_blocked, sm.i("blockedCount")), sm.i("readyCount") == 0),
        Tile(stringResource(R.string.pl_k_on_track), "${sm.i("deliverablesOnTrack")}", stringResource(R.string.pl_k_completed, sm.i("deliverablesDone")), sm.i("deliverablesOnTrack") == 0),
    )
    val labelStyle = TextStyle(fontFamily = TextFont, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
    val measureLabel = rememberWordMeasure(labelStyle)
    val density = LocalDensity.current
    @Composable fun TileBody(t: Tile, modifier: Modifier) = Column(modifier) {
        WordBoundaryText(t.label, labelStyle, Modifier.fillMaxWidth(), minLines = 2)
        Text(t.value, fontSize = 17.sp, fontWeight = if (t.zero) FontWeight.Normal else FontWeight.Bold, color = if (t.zero) c.mutedFg else t.tone ?: c.foreground, maxLines = 1)
        Text(t.sub, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        t.detail?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        t.warn?.let { Text(it, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.warningFg, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth < 600.dp) LazyRow(Modifier.fillMaxWidth().wrapContentHeight(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(tiles) { t -> TileBody(t, Modifier.width(160.dp).background(c.card, RoundedCornerShape(12.dp))
                .border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 7.dp)) }
        }
        else {
            val columns = with(density) { WordBoundaryLayout.kpiColumns(tiles.map { it.label }, (constraints.maxWidth - 2 * 12.dp.roundToPx()).toFloat(), (2 * 10.dp.roundToPx()).toFloat(), measureLabel) }
            Column(Modifier.fillMaxWidth().padding(12.dp).background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                tiles.chunked(columns).forEach { row ->
                    Row(Modifier.fillMaxWidth()) { row.forEach { t -> TileBody(t, Modifier.weight(1f).padding(horizontal = 10.dp)) } }
                }
            }
        }
    }
}

/** A stage group's mark in a column head (web GROUP_TONE). */
@Composable
internal fun groupTone(stage: String): Color = when (PipelineVocab.group(stage)) {
    "Pipeline" -> Nx.colors.blue; "Pre-Execution" -> Nx.colors.warning; "Execution" -> Nx.colors.success
    "Closed" -> Nx.colors.foreground.copy(alpha = 0.6f); else -> Nx.colors.mutedFg.copy(alpha = 0.4f)
}

/**
 * One deal as a card (§14.2, the GM's app): code · health pill; name; brand · value; the six-phase bar on every deal;
 * the blocker written out (else the first reason); a footer of PM · BD, next-action date and services. Long-press moves it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DealCard(d: PipelineDeal, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    val name = d.name.ifBlank { stringResource(R.string.pl_untitled) }
    val editable = data.canEdit && !LocalPipelinePresentation.current
    Box {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))
            .then(if (editable) Modifier.combinedClickable(onClick = { vm.open(d.id) }, onLongClick = { menu = true }, onLongClickLabel = stringResource(R.string.pl_move_named, name))
                else Modifier.clickable { vm.open(d.id) })
            .padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.code, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1, modifier = Modifier.weight(1f))
                if (d.stageGroup != "Lost") HealthPill(d.healthKey)
            }
            Text(name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
            SourceChip(d)
            if (d.brand.isNotBlank() || d.value > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.brand, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (d.value > 0) Text(pipelineMoney(d.value), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground)
            }
            // The margin on the net value (Control Tower v6): only with at least one cost line and a net value.
            if (!LocalPipelinePresentation.current) PipelineCosts.cardMargin(d)?.let { (m, pct) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.pc_margin) + ": ", fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
                    Text("${pipelineMoney(m)} (${PipelineFormat.pct(pct)})", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = marginColor(m), maxLines = 1)
                }
            }
            PhaseTrack(d.progressPhases, Modifier.fillMaxWidth().padding(vertical = 2.dp))
            val blocker = d.blockerText
            if (blocker != null) BlockerBanner(blocker, d.healthKey == "CRITICAL", maxLines = 2)
            else PipelineCard.firstReason(d)?.let { (r, more) ->
                Text(reasonText(r) + if (more > 0) " " + stringResource(R.string.pl_more_reasons, more) else "", fontSize = 11.sp, color = healthColor(d.healthKey),
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            val people = listOfNotNull(d.pmShown?.let { Triple(it, d.pm?.avatar, d.pm?.id) }, d.bdShown?.let { Triple(it, d.bd?.avatar, d.bd?.id) }).distinctBy { it.third ?: it.first }
            val due = PipelineCard.nextDate(d)
            val noPm = d.pmShown == null && PipelineCard.needsPm(d)
            val services = d.services.joinToString(", ")
            if (people.isNotEmpty() || due != null || noPm || services.isNotEmpty()) {
                androidx.compose.material3.HorizontalDivider(color = c.border)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    people.forEach { (n, a, uid) -> Avatar(n, a, 18.dp, userId = uid); Spacer(Modifier.width(2.dp)) }
                    if (people.isNotEmpty()) Spacer(Modifier.width(2.dp))
                    when {
                        noPm -> Text(stringResource(R.string.pl_no_pm), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.danger, maxLines = 1)
                        people.isNotEmpty() -> Text(people.joinToString(" · ") { it.first }, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false))
                    }
                    due?.let { day ->
                        Spacer(Modifier.width(6.dp))
                        val tone = PipelineCard.dateTone(day, data.today)
                        val col = when (tone) { PipelineCard.Tone.PAST -> c.danger; PipelineCard.Tone.TODAY -> c.warning; else -> c.mutedFg }
                        Text(if (tone == PipelineCard.Tone.TODAY) stringResource(R.string.pl_today) else PipelineCard.shortDay(day), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                            color = col, maxLines = 1, modifier = Modifier.background(col.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                    }
                    Spacer(Modifier.weight(1f).widthIn(min = 6.dp))
                    if (services.isNotEmpty()) Text(services, fontSize = 10.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.widthIn(max = 120.dp))
                }
            }
        }
        DropdownMenu(menu && editable, { menu = false }) {
            Text(stringResource(R.string.pl_move_to), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            data.vocab.stages.filter { it != d.stage }.forEach { st ->
                DropdownMenuItem(text = { Text(stageLabel(st)) }, onClick = { menu = false; vm.update(d.id, JsonObject(mapOf("stage" to JsonPrimitive(st)))) })
            }
        }
    }
}

/** Full stage names get two whole-word lines; totals do not compete with the title and controls. */
@Composable
private fun StageHead(st: String, col: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    val label = stageLabel(st)
    val a11y = pluralStringResource(R.plurals.pl_stage_n, col.size, label, col.size)
    val total = col.sumOf { it.value }
    Column(Modifier.fillMaxWidth().padding(bottom = 8.dp).semantics(mergeDescendants = true) { heading(); contentDescription = a11y }) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(groupTone(st), CircleShape)); Spacer(Modifier.width(6.dp))
            ProjectTitle(label, Modifier.weight(1f), minFontSize = 13f * .75f, normalFontSize = 13f)
            Spacer(Modifier.width(6.dp))
            Text("${col.size}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
            if (data.canEdit && !LocalPipelinePresentation.current && st != PipelineVocab.LOST) IconButton(onClick = { vm.create(st) }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.Add, stringResource(R.string.pl_add_in, label), tint = c.violetText) }
        }
        if (total > 0) Text(pipelineMoney(total), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.fillMaxWidth().padding(start = 14.dp))
    }
}

@Composable
private fun StageColumn(st: String, col: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier) {
        StageHead(st, col, data, vm)
        // Empty: a quiet line, no dashed box.
        if (col.isEmpty()) Text(stringResource(R.string.pl_no_deals), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(vertical = 8.dp))
        else LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(col, key = { it.id }) { DealCard(it, data, vm) }
        }
    }
}

/** The board: on a phone one full-width stage per page with dots (tap jumps); wider, the stages side by side. */
@Composable
private fun Board(deals: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    val stages = data.vocab.stages + deals.map { it.stage }.filter { it !in data.vocab.stages }.distinct()
    fun col(st: String) = deals.filter { it.stage == st }.sortedWith(PipelineDeal.bySeverity)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 600.dp) LazyRow(contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
            items(stages, key = { it }) { st ->
                StageColumn(st, col(st), data, vm, Modifier.width(280.dp).fillMaxHeight().background(c.muted.copy(alpha = 0.35f), RoundedCornerShape(14.dp)).padding(horizontal = 8.dp))
            }
        } else {
            val pager = rememberPagerState { stages.size }
            val scope = rememberCoroutineScope()
            Column(Modifier.fillMaxSize()) {
                HorizontalPager(pager, Modifier.weight(1f), key = { stages[it] }) { i ->
                    StageColumn(stages[i], col(stages[i]), data, vm, Modifier.fillMaxSize().padding(horizontal = 12.dp))
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.Center) {
                    stages.forEachIndexed { i, st ->
                        val on = pager.currentPage == i
                        Box(Modifier.size(28.dp).clip(CircleShape).clickable(onClickLabel = stageLabel(st)) { scope.launch { pager.animateScrollToPage(i) } }, contentAlignment = Alignment.Center) {
                            Box(Modifier.size(if (on) 9.dp else 7.dp).background(if (on) groupTone(st) else c.border, CircleShape))
                        }
                    }
                }
            }
        }
    }
}

/** The list on a phone: deals grouped by stage (the web's table is too wide here). */
@Composable
private fun ByStage(deals: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        (data.vocab.stages + deals.map { it.stage }.filter { it !in data.vocab.stages }.distinct()).forEach { st ->
            val col = deals.filter { it.stage == st }.sortedWith(PipelineDeal.bySeverity)
            if (col.isEmpty()) return@forEach
            item(key = "h-$st") {
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stageLabel(st), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.weight(1f))
                    val total = col.sumOf { it.value }
                    Text(pluralStringResource(R.plurals.pl_n_deals, col.size, col.size) + if (total > 0) " · " + pipelineMoney(total) else "", fontSize = 11.sp, color = c.mutedFg)
                }
            }
            items(col, key = { it.id }) { d ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.card).clickable { vm.open(d.id) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name.ifBlank { stringResource(R.string.pl_untitled) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        SourceChip(d)
                        Text(listOf(d.code, d.brand, d.pmShown ?: "").filter { it.isNotBlank() }.joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        // Blank instead of "–" / "Rp0"; "Not started" as plain grey text, pills for the rest.
                        if (d.value > 0) Text(pipelineMoney(d.value), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                        if (d.healthKey == "NOT_STARTED") Text(stringResource(R.string.pl_not_started), fontSize = 11.sp, color = c.mutedFg) else HealthPill(d.healthKey)
                        // The receivable: the terms' when the deal has them (§11.2), else the typed one.
                        if (d.receivable > 0) Text(stringResource(R.string.pl_t_outstanding, pipelineMoney(d.receivable)), fontSize = 10.sp,
                            color = if (d.daysOverdue > 0) c.danger else c.mutedFg, maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Health: Critical and Attention with their reasons, next actions, late payments, blockers. */
@Composable
private fun HealthView(deals: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    val urgent = deals.filter { it.healthKey == "CRITICAL" || it.healthKey == "ATTENTION" }.sortedWith(PipelineDeal.bySeverity)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section(stringResource(R.string.pl_needs_attention), stringResource(R.string.pl_healthy_open, deals.count { it.healthKey == "HEALTHY" }, deals.count { it.healthKey == "NOT_STARTED" })) {
            if (urgent.isEmpty()) Text(stringResource(R.string.pl_all_well), fontSize = 12.sp, color = c.mutedFg)
            urgent.forEach { d ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { vm.open(d.id) }.padding(vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(d.name.ifBlank { stringResource(R.string.pl_untitled) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                        HealthPill(d.healthKey)
                    }
                    SourceChip(d)
                    d.reasons.forEach { r -> Text("• " + reasonText(r), fontSize = 12.sp, color = healthColor(d.healthKey)) }
                }
            }
        }
        val next = PipelineFilter.nextActions(deals, data.today)
        Section(stringResource(R.string.pl_next_actions), stringResource(R.string.pl_within_7)) {
            if (next.isEmpty()) Text(stringResource(R.string.pl_no_next), fontSize = 12.sp, color = c.mutedFg)
            next.forEach { d ->
                val late = (d.date("nextActionDate") ?: "") < data.today
                Row(Modifier.fillMaxWidth().clickable { vm.open(d.id) }.padding(vertical = 6.dp)) {
                    Text(d.date("nextActionDate").orEmpty(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (late) c.danger else c.foreground, modifier = Modifier.width(90.dp))
                    Column(Modifier.weight(1f)) {
                        Text(d.text("nextAction").ifBlank { stringResource(R.string.pl_no_next_written) }, fontSize = 13.sp, color = c.foreground)
                        Text(d.name, fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                        SourceChip(d)
                    }
                }
            }
        }
        val late = deals.filter { it.daysOverdue > 0 }.sortedByDescending { it.daysOverdue }
        Section(stringResource(R.string.pl_late_payments), null) {
            if (late.isEmpty()) Text(stringResource(R.string.pl_no_late), fontSize = 12.sp, color = c.mutedFg)
            late.forEach { d ->
                Row(Modifier.fillMaxWidth().clickable { vm.open(d.id) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name, fontSize = 13.sp, color = c.foreground, maxLines = 1)
                        SourceChip(d)
                    }
                    Text(pipelineMoney(d.receivable) + " · " + pluralStringResource(R.plurals.pl_n_days, d.daysOverdue, d.daysOverdue), fontSize = 12.sp, color = c.danger)
                }
            }
        }
        val blocked = deals.filter { it.text("blocker").isNotBlank() && it.stageGroup != "Lost" && it.stageGroup != "Closed" }
        Section(stringResource(R.string.pl_blockers), null) {
            if (blocked.isEmpty()) Text(stringResource(R.string.pl_no_blockers), fontSize = 12.sp, color = c.mutedFg)
            blocked.forEach { d ->
                Column(Modifier.fillMaxWidth().clickable { vm.open(d.id) }.padding(vertical = 6.dp)) {
                    Text(d.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                    SourceChip(d)
                    Text(d.text("blocker"), fontSize = 12.sp, color = c.danger)
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, sub: String?, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        sub?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
        content()
    }
}
