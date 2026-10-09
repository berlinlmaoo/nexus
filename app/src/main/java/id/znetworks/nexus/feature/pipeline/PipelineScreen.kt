package id.znetworks.nexus.feature.pipeline

import android.app.Application
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
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
)

class PipelineViewModel(app: Application, handle: SavedStateHandle) : AndroidViewModel(app) {
    val projectId: String = handle["id"] ?: ""
    private val c = (app as NexusApplication).container
    val api = PipelineApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(PipelineState())
    val state = _state.asStateFlow()

    init { load() }

    /** A reload keeps what is on screen; only a first load says it failed. */
    fun load() = viewModelScope.launch {
        try {
            val d = api.load(projectId)
            _state.update { it.copy(data = d, loading = false, error = null, forbidden = false) }
            if (_state.value.people.isEmpty()) people()
        } catch (e: ApiError) {
            val h = e as? ApiError.Http
            _state.update { it.copy(loading = false, forbidden = h?.status == 403, error = if (it.data == null) e.describe(res) else null) }
        }
    }

    private var peopleAt = 0L

    /** Read fresh when a deal opens (at most once a minute), so someone the lead just added is offered at once. */
    private fun people() = viewModelScope.launch {
        peopleAt = System.currentTimeMillis()
        runCatching { api.people(projectId) }.getOrNull()?.let { p -> _state.update { it.copy(people = p) } }
    }

    fun open(id: String?) {
        _state.update { it.copy(openDealId = id) }
        if (id != null && System.currentTimeMillis() - peopleAt > 60_000) people()
    }
    fun dismiss() = _state.update { it.copy(notice = null) }

    /** New deal (optionally in a stage); opens it. */
    fun create(stage: String? = null) = viewModelScope.launch {
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
        val before = _state.value.data?.deals?.firstOrNull { it.id == dealId }
        replace(dealId) { it.with(fields) }
        viewModelScope.launch {
            try {
                val d = api.update(projectId, dealId, fields)
                replace(dealId) { d }; onDone(d); load() // KPIs come from the server
            } catch (e: ApiError) {
                before?.let { b -> replace(dealId) { b } }
                _state.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.pl_save_failed)) }
                onDone(null)
            }
        }
    }

    /** Make (or find) the won deal's execution project, then open it. */
    fun execution(deal: PipelineDeal, onOpen: (String) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try { api.execution(projectId, deal.id)?.let(onOpen); load() }
        catch (e: ApiError) { _state.update { it.copy(notice = res.getString(R.string.pl_exec_failed)) } }
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
        try { onFile(api.export(projectId, lang, java.io.File(getApplication<Application>().cacheDir, "shared/pipeline"))) }
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

    fun addTerm(dealId: String, fields: JsonObject, onDone: (Boolean) -> Unit = {}) = term(R.string.pl_t_add_failed, { api.addTerm(projectId, dealId, fields) }, onDone)
    fun updateTerm(dealId: String, termId: String, fields: JsonObject, onDone: (Boolean) -> Unit = {}) =
        term(R.string.pl_save_failed, { api.updateTerm(projectId, dealId, termId, fields) }, onDone)
    fun deleteTerm(dealId: String, termId: String) = term(R.string.pl_t_delete_failed, { api.deleteTerm(projectId, dealId, termId) })

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

/** Six segments: commercial … closing, each done / active / pending / bad (TalkBack reads them). */
@Composable
internal fun PhaseTrack(phases: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val words = phases.joinToString(", ") { (k, s) ->
        (PipelineText.phase(k)?.let { r -> res.getString(r) } ?: k) + " " + res.getString(when (s) { "done" -> R.string.pl_st_done; "active" -> R.string.pl_st_active; "bad" -> R.string.pl_st_bad; else -> R.string.pl_st_pending })
    }
    val label = stringResource(R.string.pl_phase_progress) + ": " + words
    Row(modifier.semantics { contentDescription = label }, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        phases.forEach { (_, s) ->
            Box(Modifier.weight(1f).height(5.dp).background(when (s) { "done" -> c.success; "active" -> c.violet; "bad" -> c.danger; else -> c.muted }, RoundedCornerShape(3.dp)))
        }
    }
}

/**
 * A Pipeline Dashboard project's main tab (PIPELINE-DASHBOARD §8): KPIs from the server's summary, search and
 * PM / BD / health filters, and Board · List · Health. Deals open in their own sheet; every edit is live for
 * the others through `pipeline-changed` on the project room the board screen already sits in.
 */
@Composable
fun PipelineTab(newDealRequest: Int, onOpenProject: (String) -> Unit = {}, vm: PipelineViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    var q by rememberSaveable { mutableStateOf("") }
    var pm by rememberSaveable { mutableStateOf<String?>(null) }
    var bd by rememberSaveable { mutableStateOf<String?>(null) }
    var health by rememberSaveable { mutableStateOf<String?>(null) }
    var view by rememberSaveable { mutableStateOf(PipelineView.BOARD) }
    var seenRequest by rememberSaveable { mutableStateOf(newDealRequest) }
    LaunchedEffect(newDealRequest) { if (newDealRequest != seenRequest) { seenRequest = newDealRequest; vm.create() } }
    LiveRefresh(vm.projectId, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == RealtimeEvents.PIPELINE_CHANGED && (it.projectId == null || it.projectId == vm.projectId) }) { vm.load().join() }

    val d = s.data
    when {
        s.loading && d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Text(stringResource(R.string.pl_loading), fontSize = 12.sp, color = c.mutedFg) }
        }
        s.forbidden && d == null -> EmptyState(Icons.Filled.Lock, stringResource(R.string.pl_forbidden), stringResource(R.string.pl_forbidden_sub), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        d == null -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pl_load_failed), stringResource(R.string.pl_load_failed_sub), stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
        d.deals.isEmpty() -> EmptyState(Icons.Filled.ViewKanban, stringResource(R.string.pl_empty), stringResource(R.string.pl_empty_sub), stringResource(R.string.pl_add_first), { vm.create() }, Modifier.fillMaxSize())
        else -> Column(Modifier.fillMaxSize()) {
            Kpis(d.summary)
            // Toolbar: search, PM / BD, health chips, the view, Excel.
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.pl_search_hint), maxLines = 1) },
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.export(if (java.util.Locale.getDefault().language.let { it == "in" || it == "id" }) "id" else "en") { f ->
                    runCatching {
                        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                        context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND)
                            .setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").putExtra(android.content.Intent.EXTRA_STREAM, uri)
                            .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION), null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                } }, enabled = !s.busy) { if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Filled.Download, stringResource(R.string.pl_export), tint = c.violetText) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                val pms = d.deals.mapNotNull { x -> (x.pmUserId ?: x.pmShown)?.let { it to (x.pmShown ?: "—") } }.distinct().sortedBy { it.second.lowercase() }
                val bds = d.deals.mapNotNull { x -> (x.bdUserId ?: x.bdShown)?.let { it to (x.bdShown ?: "—") } }.distinct().sortedBy { it.second.lowercase() }
                PersonFilter(pms.firstOrNull { it.first == pm }?.second ?: stringResource(R.string.pl_all_pm), pms, stringResource(R.string.pl_all_pm)) { pm = it }
                PersonFilter(bds.firstOrNull { it.first == bd }?.second ?: stringResource(R.string.pl_all_bd), bds, stringResource(R.string.pl_all_bd)) { bd = it }
                listOf(null, "CRITICAL", "ATTENTION", "HEALTHY", "NOT_STARTED").forEach { k ->
                    FilterChip(health == k, { health = k }, { Text(if (k == null) stringResource(R.string.tk_all) else stringResource(PipelineText.health(k))) })
                }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                listOf(PipelineView.BOARD to R.string.ptab_board, PipelineView.LIST to R.string.ptab_list, PipelineView.HEALTH to R.string.pl_health).forEachIndexed { i, (v, l) ->
                    SegmentedButton(view == v, { view = v }, SegmentedButtonDefaults.itemShape(i, 3), icon = {}) { Text(stringResource(l)) }
                }
            }
            val shown = PipelineFilter.apply(d.deals, q, pm, bd, health)
            if (shown.size != d.deals.size) Text(stringResource(R.string.pl_shown_of, shown.size, d.deals.size), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))
            Box(Modifier.weight(1f)) {
                if (shown.isEmpty()) EmptyState(Icons.Filled.Search, stringResource(R.string.pl_no_match),
                    pluralStringResource(R.plurals.pl_filters_hide, d.deals.size, d.deals.size), stringResource(R.string.clear_search),
                    { q = ""; pm = null; bd = null; health = null }, Modifier.fillMaxSize())
                else when (view) {
                    PipelineView.BOARD -> Board(shown, d, vm)
                    PipelineView.LIST -> ByStage(shown, d, vm)
                    PipelineView.HEALTH -> HealthView(shown, d, vm)
                }
            }
        }
    }
    s.openDealId?.let { id -> d?.deals?.firstOrNull { it.id == id }?.let { deal -> DealSheet(deal, d, s.people, vm, onOpenProject = { pid -> vm.open(null); onOpenProject(pid) }) { vm.open(null) } } }
    s.notice?.let { androidx.compose.material3.AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
}

@Composable
private fun PersonFilter(label: String, people: List<Pair<String, String>>, all: String, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 140.dp)); Icon(Icons.Filled.KeyboardArrowDown, null) }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text(all) }, onClick = { open = false; onPick(null) })
            people.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { open = false; onPick(id) }) }
        }
    }
}

/** The KPI strip over every deal (one row, sideways on a phone). */
@Composable
private fun Kpis(sm: PipelineSummary) {
    val c = Nx.colors
    val tiles = listOf(
        Triple(stringResource(R.string.pl_k_open), PipelineFormat.idr(sm.n("openValue")), pluralStringResource(R.plurals.pl_k_in_play, sm.i("openCount"), sm.i("openCount"))),
        Triple(stringResource(R.string.pl_k_weighted), PipelineFormat.idr(sm.n("weightedValue")), stringResource(R.string.pl_k_weighted_sub)),
        Triple(stringResource(R.string.pl_k_won), PipelineFormat.idr(sm.n("wonValue")), stringResource(R.string.pl_k_won_sub, sm.i("activeCount"), sm.i("lostCount"))),
        Triple(stringResource(R.string.pl_k_receivable), PipelineFormat.idr(sm.n("receivable")), stringResource(R.string.pl_k_overdue, PipelineFormat.idr(sm.n("receivableOverdue")))),
        Triple(stringResource(R.string.pl_critical), "${sm.i("criticalCount")}", stringResource(R.string.pl_k_attention, sm.i("attentionCount"))),
        Triple(stringResource(R.string.pl_k_ready), "${sm.i("readyCount")}", stringResource(R.string.pl_k_blocked, sm.i("blockedCount"))),
        Triple(stringResource(R.string.pl_k_on_track), "${sm.i("deliverablesOnTrack")}", stringResource(R.string.pl_k_completed, sm.i("deliverablesDone"))),
    )
    LazyRow(contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(tiles) { (label, value, sub) ->
            Column(Modifier.width(150.dp).background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(10.dp)) {
                Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(value, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1)
                Text(sub, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** One deal as a card: code, name, health, brand, value, phases, blocker, PM. */
@Composable
private fun DealCard(d: PipelineDeal, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))
        .clickable { vm.open(d.id) }.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(d.code, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.weight(1f))
            HealthPill(d.healthKey)
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, stringResource(R.string.pl_move_named, d.name.ifBlank { stringResource(R.string.pl_untitled) }), tint = c.mutedFg) }
                DropdownMenu(menu, { menu = false }) {
                    Text(stringResource(R.string.pl_move_to), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                    data.vocab.stages.filter { it != d.stage }.forEach { st ->
                        DropdownMenuItem(text = { Text(stageLabel(st)) }, onClick = { menu = false; vm.update(d.id, JsonObject(mapOf("stage" to JsonPrimitive(st)))) })
                    }
                }
            }
        }
        Text(d.name.ifBlank { stringResource(R.string.pl_untitled) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (d.brand.isNotBlank()) Text(d.brand, fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
        Text(if (d.value > 0) PipelineFormat.idr(d.value) else stringResource(R.string.pl_no_value), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (d.value > 0) c.foreground else c.mutedFg)
        PhaseTrack(d.phases, Modifier.fillMaxWidth())
        d.text("blocker").takeIf { it.isNotBlank() }?.let { Text("⚠ $it", fontSize = 11.sp, color = c.danger, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        val won = d.stageGroup in setOf("Pre-Execution", "Execution", "Closed")
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (d.pmShown != null) { Avatar(d.pmShown, d.pm?.avatar, 18.dp); Spacer(Modifier.width(4.dp)); Text(d.pmShown!!, fontSize = 11.sp, color = c.mutedFg, maxLines = 1) }
            else if (won) Text(stringResource(R.string.pl_no_pm), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
        }
    }
}

/** The board: the eight stages side by side, each with its count and total. */
@Composable
private fun Board(deals: List<PipelineDeal>, data: PipelineData, vm: PipelineViewModel) {
    val c = Nx.colors
    LazyRow(contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        items(data.vocab.stages + deals.map { it.stage }.filter { it !in data.vocab.stages }.distinct(), key = { it }) { st ->
            val col = deals.filter { it.stage == st }.sortedWith(PipelineDeal.bySeverity)
            Column(Modifier.width(270.dp).fillMaxHeight().background(c.muted.copy(alpha = 0.35f), RoundedCornerShape(14.dp)).padding(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stageLabel(st), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${col.size} · ${PipelineFormat.idr(col.sumOf { it.value })}", fontSize = 11.sp, color = c.mutedFg)
                }
                Spacer(Modifier.height(6.dp))
                LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (col.isEmpty()) item { Text(stringResource(R.string.pl_no_deals), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(8.dp)) }
                    items(col, key = { it.id }) { DealCard(it, data, vm) }
                }
                if (st != PipelineVocab.LOST) TextButton(onClick = { vm.create(st) }) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.pl_add_here)) }
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
                    Text(pluralStringResource(R.plurals.pl_n_deals, col.size, col.size) + " · " + PipelineFormat.idr(col.sumOf { it.value }), fontSize = 11.sp, color = c.mutedFg)
                }
            }
            items(col, key = { it.id }) { d ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.card).clickable { vm.open(d.id) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(d.name.ifBlank { stringResource(R.string.pl_untitled) }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOf(d.code, d.brand, d.pmShown ?: "").filter { it.isNotBlank() }.joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(if (d.value > 0) PipelineFormat.idr(d.value) else "–", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                        HealthPill(d.healthKey)
                        // The receivable: the terms' when the deal has them (§11.2), else the typed one.
                        if (d.receivable > 0) Text(stringResource(R.string.pl_t_outstanding, PipelineFormat.idr(d.receivable)), fontSize = 10.sp,
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
                    }
                }
            }
        }
        val late = deals.filter { it.daysOverdue > 0 }.sortedByDescending { it.daysOverdue }
        Section(stringResource(R.string.pl_late_payments), null) {
            if (late.isEmpty()) Text(stringResource(R.string.pl_no_late), fontSize = 12.sp, color = c.mutedFg)
            late.forEach { d ->
                Row(Modifier.fillMaxWidth().clickable { vm.open(d.id) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(d.name, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                    Text(PipelineFormat.idr(d.receivable) + " · " + pluralStringResource(R.plurals.pl_n_days, d.daysOverdue, d.daysOverdue), fontSize = 12.sp, color = c.danger)
                }
            }
        }
        val blocked = deals.filter { it.text("blocker").isNotBlank() && it.stageGroup != "Lost" && it.stageGroup != "Closed" }
        Section(stringResource(R.string.pl_blockers), null) {
            if (blocked.isEmpty()) Text(stringResource(R.string.pl_no_blockers), fontSize = 12.sp, color = c.mutedFg)
            blocked.forEach { d ->
                Column(Modifier.fillMaxWidth().clickable { vm.open(d.id) }.padding(vertical = 6.dp)) {
                    Text(d.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
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
