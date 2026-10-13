package id.znetworks.nexus.feature.sheets

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvent
import id.znetworks.nexus.core.realtime.RealtimeEvents
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A cell address in id-space. */
data class CellKey(val rowId: String, val colId: String)

/** An edit waiting on the "Heads up!" answer of a warn-protected range. */
data class WarnEdit(val key: CellKey, val value: JsonElement)

data class SheetUi(
    val tabs: List<SheetTab>? = null,
    val sheetId: String? = null,
    val data: SheetData? = null,
    val loading: Boolean = true,
    /** The sheet (or the tab list) could not be read and there is nothing on screen. */
    val loadError: String? = null,
    val selected: CellKey? = null,
    /** What the edit bar holds while typing; null = not editing. */
    val draft: String? = null,
    val pending: Int = 0,
    val offline: Boolean = false,
    val saving: Boolean = false,
    /** A sentence to show once (refusals, the protection line, the offline rule for structure changes). */
    val notice: String? = null,
    val warn: WarnEdit? = null,
    /** Cells changed here and not yet re-read: a formula among them shows its old text, dimmed. */
    val stale: Set<CellKey> = emptySet(),
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
    val busy: Boolean = false,
)

/**
 * The project Spreadsheet on the phone (web SheetMobile + ProjectSheetView, iOS SheetStore/SheetOutbox): reads
 * the server's computed view, writes typed values through one serial queue per sheet, follows realtime.
 */
class SheetStore(app: Application, private val projectId: String) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = SheetApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val me: String? get() = c.sessionStore.current?.userId
    private val prefs = app.getSharedPreferences("sheet_tab", android.content.Context.MODE_PRIVATE)
    private val _ui = MutableStateFlow(SheetUi())
    val ui = _ui.asStateFlow()

    private var queue = SheetQueue()
    private var flushJob: Job? = null
    private var refetchJob: Job? = null
    /** The display text a cell had before it was changed here (shown dimmed for formulas until re-read). */
    private val oldText = HashMap<CellKey, String>()
    private data class Edit(val key: CellKey, val before: JsonElement, val after: JsonElement)
    private val undoStack = ArrayDeque<Edit>()
    private val redoStack = ArrayDeque<Edit>()

    init {
        loadTabs()
        viewModelScope.launch { c.realtime.events.collect(::onEvent) }
    }

    // region Loading

    fun loadTabs(open: String? = null) = viewModelScope.launch {
        try {
            val tabs = api.tabs(projectId)
            _ui.update { it.copy(tabs = tabs, loadError = null) }
            val shown = tabs.filterNot { it.hidden }.ifEmpty { tabs.take(1) }
            val want = open ?: _ui.value.sheetId ?: prefs.getString(projectId, null)
            val pick = shown.firstOrNull { it.id == want } ?: shown.firstOrNull()
            if (pick == null) _ui.update { it.copy(loading = false, data = null, sheetId = null) } else if (pick.id != _ui.value.sheetId || _ui.value.data == null) select(pick.id)
        } catch (e: ApiError) {
            _ui.update { it.copy(loading = false, loadError = if (it.tabs == null) failure(e) else it.loadError, notice = if (it.tabs != null) failure(e) else it.notice) }
        }
    }

    fun select(sheetId: String) {
        prefs.edit().putString(projectId, sheetId).apply()
        queue = SheetOutbox.load(getApplication(), sheetId, me)
        undoStack.clear(); redoStack.clear(); oldText.clear()
        _ui.update { it.copy(sheetId = sheetId, data = null, loading = true, loadError = null, selected = null, draft = null, stale = emptySet(),
            pending = queue.count, canUndo = false, canRedo = false) }
        reload()
        if (!queue.isEmpty) flush()
    }

    fun reload() = viewModelScope.launch {
        val id = _ui.value.sheetId ?: return@launch
        try {
            val d = api.sheet(id) ?: throw ApiError.Decoding(IllegalStateException("no sheet"))
            if (_ui.value.sheetId != id) return@launch
            _ui.update { it.copy(data = overlayPending(d, it.data), loading = false, loadError = null, stale = it.stale.filter { k -> queue.valuesFor(k.rowId).containsKey(k.colId) }.toSet()) }
        } catch (e: ApiError) {
            // The open sheet is gone (deleted elsewhere): the first tab.
            if (e is ApiError.Http && e.status == 404) { loadTabs(open = null); _ui.update { it.copy(sheetId = null) }; return@launch }
            _ui.update { it.copy(loading = false, loadError = if (it.data == null) failure(e) else null) }
        }
    }

    /** The server's copy with this phone's unsent values laid back over it (and newer local rows kept). */
    private fun overlayPending(server: SheetData, local: SheetData?): SheetData {
        val localRows = local?.rows?.associateBy { it.id }.orEmpty()
        val editing = _ui.value.selected.takeIf { _ui.value.draft != null }
        val rows = server.rows.map { r ->
            val mine = localRows[r.id]
            val keep = queue.valuesFor(r.id).keys + listOfNotNull(editing?.takeIf { it.rowId == r.id }?.colId)
            val base = if (mine != null && !SheetMerge.newerOrSame(r.updatedAt, mine.updatedAt)) mine else r
            val cells = base.cells.toMutableMap()
            queue.valuesFor(r.id).forEach { (col, v) -> if (v is JsonNull) cells.remove(col) else cells[col] = v }
            if (mine != null) keep.forEach { col -> if (col !in queue.valuesFor(r.id)) mine.cells[col]?.let { cells[col] = it } }
            base.copy(cells = cells)
        }
        return server.copy(rows = rows)
    }

    // endregion

    // region Reading a cell

    fun text(d: SheetData, row: SheetRow, col: SheetColumn): Pair<String, Boolean> {
        val key = CellKey(row.id, col.id)
        val raw = row.cells[col.id]
        val stale = key in _ui.value.stale
        val comp = d.computed[row.id]?.get(col.id)
        if (!stale && comp != null) return comp.d to false
        if (SheetCells.isFormula(raw)) return (oldText[key] ?: comp?.d ?: "") to true
        return SheetCells.display(col.type, raw, d.en) to false
    }

    // endregion

    // region Editing

    fun selectCell(key: CellKey?) = _ui.update { it.copy(selected = key, draft = null) }
    fun startEdit() {
        val s = _ui.value; val d = s.data ?: return; val k = s.selected ?: return
        if (!canEdit()) return
        val col = d.columns.firstOrNull { it.id == k.colId } ?: return
        val raw = d.rows.firstOrNull { it.id == k.rowId }?.cells?.get(k.colId)
        _ui.update { it.copy(draft = SheetCells.editText(col.type, raw, d.shape, d.en)) }
    }
    fun setDraft(t: String) = _ui.update { it.copy(draft = t) }
    fun cancelEdit() = _ui.update { it.copy(draft = null) }

    fun canEdit(): Boolean = _ui.value.data?.let { it.canEdit && !it.pivot } == true

    /** ✓ / Enter: the typed text becomes the cell's value; the selection moves down. */
    fun commit() {
        val s = _ui.value; val d = s.data ?: return; val k = s.selected ?: return
        val text = s.draft ?: return
        val col = d.columns.firstOrNull { it.id == k.colId } ?: return
        val raw = d.rows.firstOrNull { it.id == k.rowId }?.cells?.get(k.colId)
        val value = SheetCells.inputToCell(col.type, text, d.shape, raw, d.en)
        _ui.update { it.copy(draft = null) }
        write(k, value)
        moveDown()
    }

    /** A checkbox cell: tick / untick. */
    fun toggle(k: CellKey) {
        val raw = _ui.value.data?.rows?.firstOrNull { it.id == k.rowId }?.cells?.get(k.colId)
        write(k, JsonPrimitive(!SheetCells.checked(raw)))
    }

    /** A dropdown pick (several joined by ", " for a multi-select). */
    fun pick(k: CellKey, value: String) = write(k, if (value.isEmpty()) JsonNull else JsonPrimitive(value))

    fun clear(k: CellKey) = write(k, JsonNull)

    private fun moveDown() {
        val d = _ui.value.data ?: return; val k = _ui.value.selected ?: return
        val visible = d.rows.filter { it.id !in d.hiddenRows }
        val i = visible.indexOfFirst { it.id == k.rowId }
        visible.getOrNull(i + 1)?.let { r -> _ui.update { it.copy(selected = CellKey(r.id, k.colId)) } }
    }

    /** Every write goes through the protection guard (the server enforces "restrict" anyway). */
    private fun write(k: CellKey, value: JsonElement, fromHistory: Boolean = false) {
        if (!canEdit()) return
        val d = _ui.value.data ?: return
        val r = d.rows.indexOfFirst { it.id == k.rowId }; val ci = d.columns.indexOfFirst { it.id == k.colId }
        if (r < 0 || ci < 0) return
        val p = SheetRanges.protectionAt(SheetRanges.protections(d.settings), r, ci, d.shape)
        if (p != null && !SheetRanges.mayEdit(p, me, d.canManage)) {
            if (p.restrict) { _ui.update { it.copy(notice = res.getString(R.string.sh_protected)) }; return }
            if (!fromHistory) { _ui.update { it.copy(warn = WarnEdit(k, value)) }; return }
        }
        apply(k, value, fromHistory)
    }

    fun confirmWarn() { val w = _ui.value.warn ?: return; _ui.update { it.copy(warn = null) }; apply(w.key, w.value, false) }
    fun dismissWarn() = _ui.update { it.copy(warn = null) }

    private fun apply(k: CellKey, value: JsonElement, fromHistory: Boolean) {
        val d = _ui.value.data ?: return
        val row = d.rows.firstOrNull { it.id == k.rowId } ?: return
        val before = row.cells[k.colId] ?: JsonNull
        if (SheetCells.sameCell(before, value)) return
        val col = d.columns.firstOrNull { it.id == k.colId }
        if (col != null) oldText.getOrPut(k) { text(d, row, col).first }
        val cells = row.cells.toMutableMap().also { if (value is JsonNull) it.remove(k.colId) else it[k.colId] = value }
        _ui.update { s ->
            s.copy(data = d.copy(rows = d.rows.map { if (it.id == k.rowId) it.copy(cells = cells) else it }), stale = s.stale + k)
        }
        if (!fromHistory) { undoStack.addLast(Edit(k, before, value)); if (undoStack.size > 100) undoStack.removeFirst(); redoStack.clear() }
        queue.put(k.rowId, k.colId, value)
        persist()
        flush()
    }

    fun undo() { val e = undoStack.removeLastOrNull() ?: return; redoStack.addLast(e); write(e.key, e.before, fromHistory = true); history() }
    fun redo() { val e = redoStack.removeLastOrNull() ?: return; undoStack.addLast(e); write(e.key, e.after, fromHistory = true); history() }
    private fun history() = _ui.update { it.copy(canUndo = undoStack.isNotEmpty(), canRedo = redoStack.isNotEmpty()) }

    private fun persist() {
        val id = _ui.value.sheetId ?: return
        SheetOutbox.save(getApplication(), id, me, queue)
        _ui.update { it.copy(pending = queue.count, canUndo = undoStack.isNotEmpty(), canRedo = redoStack.isNotEmpty()) }
    }

    // endregion

    // region Saving (one request in flight per sheet)

    /** Sends the queue, batch after batch; a network failure retries with backoff (1 s → 30 s). */
    fun flush() {
        if (flushJob?.isActive == true) return
        val sheetId = _ui.value.sheetId ?: return
        flushJob = viewModelScope.launch {
            var wait = 1_000L
            // Edits typed within a moment go out together.
            delay(250)
            while (_ui.value.sheetId == sheetId) {
                val batch = queue.take() ?: break
                _ui.update { it.copy(saving = true) }
                try {
                    val saved = api.saveCells(sheetId, batch)
                    queue.succeeded(); persist()
                    mergeRows(saved)
                    _ui.update { it.copy(offline = false, saving = false) }
                    wait = 1_000L
                    scheduleRefetch()
                } catch (e: ApiError) {
                    val retry = e is ApiError.Transport || (e is ApiError.Http && (e.status >= 500 || e.status == 429)) || e is ApiError.Unauthorized
                    if (retry) {
                        queue.putBack(); persist()
                        _ui.update { it.copy(offline = e !is ApiError.Unauthorized, saving = false) }
                        if (e is ApiError.Unauthorized) return@launch
                        delay(wait); wait = (wait * 2).coerceAtMost(30_000L)
                    } else {
                        // Protection, a deleted column, the sheet gone: dropped, said, and the sheet read again.
                        queue.dropped(); persist()
                        _ui.update { it.copy(saving = false, notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.sh_some_failed)) }
                        reload()
                    }
                }
            }
            _ui.update { it.copy(saving = false) }
        }
    }

    /** The app came back to the front / the socket reconnected: try the queue at once. */
    fun retryNow() { flushJob?.cancel(); flushJob = null; queue.putBack(); flush() }

    private fun mergeRows(incoming: List<SheetRow>) {
        if (incoming.isEmpty()) return
        val d = _ui.value.data ?: return
        val editing = _ui.value.selected.takeIf { _ui.value.draft != null }
        val byId = incoming.associateBy { it.id }
        val rows = d.rows.map { r ->
            val n = byId[r.id] ?: return@map r
            if (!SheetMerge.newerOrSame(n.updatedAt, r.updatedAt)) return@map r
            SheetMerge.apply(r, n, queue.valuesFor(r.id).keys + listOfNotNull(editing?.takeIf { it.rowId == r.id }?.colId))
        }
        _ui.update { it.copy(data = d.copy(rows = rows)) }
    }

    /** Values that depend on a change come from the server: read the computed view 600 ms after the last one. */
    private fun scheduleRefetch() {
        refetchJob?.cancel()
        refetchJob = viewModelScope.launch {
            delay(600)
            if (_ui.value.draft != null || !queue.isEmpty) return@launch
            val id = _ui.value.sheetId ?: return@launch
            runCatching { api.sheet(id) }.getOrNull()?.let { fresh ->
                if (_ui.value.sheetId != id) return@launch
                _ui.update { s ->
                    s.copy(data = overlayPending(fresh, s.data), stale = s.stale.filter { k -> queue.valuesFor(k.rowId).containsKey(k.colId) }.toSet())
                }
                oldText.clear()
            }
        }
    }

    // endregion

    // region Realtime (room sheet:<id>)

    private fun onEvent(e: RealtimeEvent) {
        val id = _ui.value.sheetId ?: return
        when (e.name) {
            RealtimeEvents.RECONNECTED -> { if (!queue.isEmpty) retryNow(); scheduleRefetch() }
            SheetEvents.CELLS, SheetEvents.STRUCTURE -> {
                val o = e.raw?.let { runCatching { NexusJson.parseToJsonElement(it) as? JsonObject }.getOrNull() } ?: return
                if ((o["sheetId"] as? JsonPrimitive)?.content != id) return
                val origin = (o["originTab"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                val actor = (o["actorId"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (SheetMerge.isEcho(origin, actor, SheetApi.TAB_ID, me)) return
                if (e.name == SheetEvents.CELLS) { mergeRows(SheetParse.rows(o)); scheduleRefetch() }
                else { reload(); loadTabs() }
            }
        }
    }

    // endregion

    // region Tabs, rows, columns (online only)

    private fun online(): Boolean {
        if (_ui.value.offline) { _ui.update { it.copy(notice = res.getString(R.string.sh_offline_structure)) }; return false }
        return true
    }

    private fun structure(fail: Int, block: suspend () -> Unit) {
        if (!online()) return
        viewModelScope.launch {
            _ui.update { it.copy(busy = true) }
            try { block() } catch (e: ApiError) { _ui.update { it.copy(notice = (e as? ApiError.Http)?.serverMessage ?: res.getString(fail)) } }
            _ui.update { it.copy(busy = false) }
        }
    }

    fun addSheet() = structure(R.string.sh_add_failed) { val id = api.create(projectId); loadTabs(open = id) }
    fun duplicateSheet(t: SheetTab) = structure(R.string.sh_dup_failed) { val id = api.duplicate(projectId, t.id); loadTabs(open = id) }
    fun renameSheet(t: SheetTab, name: String) = structure(R.string.sh_rename_failed) { api.rename(t.id, name); loadTabs() }

    /** Refused here first: the last sheet, or the project's main (first) one. */
    fun deleteRefusal(t: SheetTab): String? = when {
        (_ui.value.tabs?.size ?: 0) <= 1 -> res.getString(R.string.sh_need_one)
        t.position == 0 || _ui.value.tabs?.firstOrNull()?.id == t.id -> res.getString(R.string.sh_main_sheet)
        else -> null
    }
    fun deleteSheet(t: SheetTab) = structure(R.string.sh_delete_failed) {
        api.delete(t.id)
        if (_ui.value.sheetId == t.id) _ui.update { it.copy(sheetId = null) }
        loadTabs()
    }

    fun insertRow(rowId: String, above: Boolean) = structure(R.string.sh_some_failed) {
        val id = _ui.value.sheetId ?: return@structure
        if (above) api.insertRow(id, null, rowId) else api.insertRow(id, rowId, null)
        reload()
    }
    fun deleteRow(rowId: String) = structure(R.string.sh_some_failed) {
        val id = _ui.value.sheetId ?: return@structure
        api.deleteRows(id, listOf(rowId)); _ui.update { it.copy(selected = null) }; reload()
    }
    fun insertColumn(colId: String, left: Boolean) = structure(R.string.sh_col_add_failed) {
        val d = _ui.value.data ?: return@structure
        val i = d.columns.indexOfFirst { it.id == colId }.takeIf { it >= 0 } ?: return@structure
        val list = d.columns.map { it.raw }.toMutableList()
        list.add(if (left) i else i + 1, buildJsonObject { put("name", ""); put("type", "text") })
        api.setColumns(d.id, list); reload()
    }
    fun deleteColumn(colId: String) {
        if ((_ui.value.data?.columns?.size ?: 0) <= 1) { _ui.update { it.copy(notice = res.getString(R.string.sh_need_column)) }; return }
        structure(R.string.sh_col_delete_failed) {
            val id = _ui.value.sheetId ?: return@structure
            api.deleteColumn(id, colId); _ui.update { it.copy(selected = null) }; reload()
        }
    }

    // endregion

    fun noticeShown() = _ui.update { it.copy(notice = null) }

    private fun failure(e: ApiError): String = when (e) {
        is ApiError.Http -> e.serverMessage ?: res.getString(R.string.sh_load_failed)
        else -> res.getString(R.string.sh_load_failed)
    }
}

/** Sheet realtime event names (server since 12 Oct). */
object SheetEvents {
    const val CELLS = "sheet-cells"
    const val STRUCTURE = "sheet-structure"
}
