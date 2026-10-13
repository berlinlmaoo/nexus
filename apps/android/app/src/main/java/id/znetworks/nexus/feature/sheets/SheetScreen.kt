package id.znetworks.nexus.feature.sheets

import android.app.Application
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.outlined.GridOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.R
import id.znetworks.nexus.core.realtime.RealtimeRoom
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The project's Spreadsheet tab on a phone (web SheetMobile): the sheet tabs, a grid with sticky letters and row
 * numbers (frozen rows / columns stay put), the edit bar, and the save status. Formatting tools, charts, filters
 * and the rest stay on the web.
 */
@Composable
fun ProjectSheetTab(projectId: String, onOpenWeb: () -> Unit) {
    val app = LocalContext.current.applicationContext as Application
    val store: SheetStore = viewModel(key = "sheet-$projectId") { SheetStore(app, projectId) }
    val s by store.ui.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    RealtimeRoom(s.sheetId?.let { "sheet:$it" })
    // Back in front: anything unsent goes at once.
    LifecycleResumeEffect(Unit) { store.flush(); onPauseOrDispose { } }
    LaunchedEffect(s.notice) { s.notice?.let { android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show(); store.noticeShown() } }

    val d = s.data
    Column(Modifier.fillMaxSize().background(c.background)) {
        when {
            s.tabs == null && s.loadError != null -> { LoadFailed(s.loadError!!) { store.loadTabs() }; return@Column }
            s.tabs == null -> { Centered(); return@Column }
            s.tabs!!.isEmpty() -> {
                EmptyState(Icons.Outlined.GridOn, stringResource(R.string.sh_empty), stringResource(R.string.sh_empty_sub),
                    stringResource(R.string.sh_add_sheet), { store.addSheet() }, Modifier.fillMaxSize())
                return@Column
            }
        }
        SheetTabs(s.tabs.orEmpty(), s.sheetId, canEdit = d?.canEdit == true, canManage = d?.canManage == true, store)
        StatusLine(s, d)
        Box(Modifier.weight(1f)) {
            when {
                d == null && s.loadError != null -> LoadFailed(s.loadError!!) { store.reload() }
                d == null -> Centered()
                else -> Grid(d, s, store)
            }
        }
        if (d != null && s.selected != null) EditBar(d, s, store)
    }
    s.warn?.let {
        AlertDialog(onDismissRequest = store::dismissWarn, title = { Text(stringResource(R.string.sh_heads_up)) },
            text = { Text(stringResource(R.string.sh_heads_up_body)) },
            confirmButton = { TextButton(onClick = store::confirmWarn) { Text("OK") } },
            dismissButton = { TextButton(onClick = store::dismissWarn) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Centered() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

@Composable
private fun LoadFailed(message: String, onRetry: () -> Unit) =
    EmptyState(Icons.Outlined.GridOn, stringResource(R.string.sh_load_failed), message, stringResource(R.string.try_again), onRetry, Modifier.fillMaxSize())

// region Tabs

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SheetTabs(tabs: List<SheetTab>, current: String?, canEdit: Boolean, canManage: Boolean, store: SheetStore) {
    val c = Nx.colors
    var menuFor by remember { mutableStateOf<SheetTab?>(null) }
    var renaming by remember { mutableStateOf<SheetTab?>(null) }
    var deleting by remember { mutableStateOf<SheetTab?>(null) }
    var refusal by remember { mutableStateOf<String?>(null) }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        tabs.filterNot { it.hidden }.ifEmpty { tabs.take(1) }.forEach { t ->
            val on = t.id == current
            Text(t.name.ifBlank { "Sheet" }, fontFamily = TextFont, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = if (on) c.foreground else c.mutedFg, maxLines = 1,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) c.muted else Color.Transparent)
                    .combinedClickable(onClick = { if (!on) store.select(t.id) }, onLongClick = { menuFor = t })
                    .defaultMinSize(minHeight = 40.dp).padding(horizontal = 12.dp, vertical = 10.dp))
        }
        if (canEdit) IconButton(onClick = store::addSheet) { Icon(Icons.Filled.Add, stringResource(R.string.sh_add_sheet), tint = c.mutedFg) }
    }
    HorizontalDivider(color = c.border)
    menuFor?.let { t ->
        AlertDialog(onDismissRequest = { menuFor = null }, title = { Text(t.name) },
            text = {
                Column {
                    @Composable fun row(label: String, color: Color = c.foreground, onClick: () -> Unit) =
                        Text(label, fontSize = 15.sp, color = color, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { menuFor = null; onClick() }.padding(vertical = 12.dp))
                    if (canEdit) {
                        row(stringResource(R.string.sh_rename)) { renaming = t }
                        row(stringResource(R.string.sh_duplicate)) { store.duplicateSheet(t) }
                    }
                    if (canManage) row(stringResource(R.string.sh_delete), c.dangerText) { val r = store.deleteRefusal(t); if (r != null) refusal = r else deleting = t }
                    if (!canEdit) Text(stringResource(R.string.sh_view_only), fontSize = 13.sp, color = c.mutedFg)
                }
            },
            confirmButton = {}, dismissButton = { TextButton(onClick = { menuFor = null }) { Text(stringResource(R.string.cancel)) } })
    }
    renaming?.let { t ->
        var name by rememberSaveable { mutableStateOf(t.name) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text(stringResource(R.string.sh_rename_title)) },
            text = { OutlinedTextField(name, { name = it.take(80) }, singleLine = true, label = { Text(stringResource(R.string.sh_sheet_name)) }) },
            confirmButton = { TextButton(onClick = { renaming = null; store.renameSheet(t, name) }, enabled = name.isNotBlank()) { Text(stringResource(R.string.sh_save)) } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text(stringResource(R.string.cancel)) } })
    }
    deleting?.let { t ->
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text(stringResource(R.string.sh_delete_q)) },
            text = { Text(stringResource(R.string.sh_delete_body, t.name)) },
            confirmButton = { TextButton(onClick = { deleting = null; store.deleteSheet(t) }) { Text(stringResource(R.string.sh_delete), color = c.dangerText) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } })
    }
    refusal?.let { r -> AlertDialog(onDismissRequest = { refusal = null }, text = { Text(r) }, confirmButton = { TextButton(onClick = { refusal = null }) { Text("OK") } }) }
}

@Composable
private fun StatusLine(s: SheetUi, d: SheetData?) {
    val c = Nx.colors
    if (d == null) return
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            !d.canEdit || d.pivot -> Text(stringResource(R.string.sh_view_only), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(c.muted).padding(horizontal = 8.dp, vertical = 2.dp))
            s.offline && s.pending > 0 -> {
                Icon(Icons.Filled.CloudOff, null, tint = c.warningFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.sh_offline, s.pending), fontSize = 12.sp, color = c.warningFg)
            }
            s.saving || s.pending > 0 -> Text(stringResource(R.string.sh_saving), fontSize = 12.sp, color = c.mutedFg)
            else -> Text(stringResource(R.string.sh_saved), fontSize = 12.sp, color = c.mutedFg)
        }
    }
}

// endregion

// region Grid

private val NUM_W = 40.dp
private fun colWidth(col: SheetColumn): Dp = col.width?.let { (it * 0.8f).coerceIn(80f, 160f).dp } ?: 108.dp
private fun rowHeight(r: SheetRow): Dp = maxOf(34, r.height ?: 26).dp

@Composable
private fun Grid(d: SheetData, s: SheetUi, store: SheetStore) {
    val c = Nx.colors
    val h = rememberScrollState()
    val shape = d.shape
    val allCols = d.columns
    val frozenColIds = allCols.take(d.frozenCols).map { it.id }.toSet()
    val cols = allCols.filter { it.id !in d.hiddenCols }
    val leftCols = cols.filter { it.id in frozenColIds }
    val rightCols = cols.filter { it.id !in frozenColIds }
    val frozenRowIds = d.rows.take(d.frozenRows).map { it.id }.toSet()
    val rows = d.rows.filter { it.id !in d.hiddenRows }
    val topRows = rows.filter { it.id in frozenRowIds }
    val bodyRows = rows.filter { it.id !in frozenRowIds }
    val away = remember(d) { SheetRanges.mergedAway(d.settings, shape) }
    val showNames = cols.any { it.name.isNotBlank() || it.type != "text" }
    Column(Modifier.fillMaxSize()) {
        // Letters (and the column names, when any column has one or a non-text type), sticky.
        HeaderRow(leftCols, rightCols, h, shape) { col -> SheetFormula.colLetter(shape.columnIds.indexOf(col.id)) }
        if (showNames) HeaderRow(leftCols, rightCols, h, shape, names = true) { col -> col.name }
        topRows.forEach { r -> GridRow(d, s, store, r, leftCols, rightCols, h, away) }
        if (topRows.isNotEmpty()) HorizontalDivider(color = c.boundary, thickness = 2.dp)
        LazyColumn(Modifier.weight(1f)) {
            items(bodyRows, key = { it.id }) { r -> GridRow(d, s, store, r, leftCols, rightCols, h, away) }
        }
    }
}

@Composable
private fun HeaderRow(left: List<SheetColumn>, right: List<SheetColumn>, h: ScrollState, shape: SheetFormula.Shape, names: Boolean = false, label: (SheetColumn) -> String) {
    val c = Nx.colors
    @Composable fun cell(col: SheetColumn) = Box(Modifier.width(colWidth(col)).height(if (names) 26.dp else 24.dp).background(c.muted).border(0.5.dp, c.border),
        contentAlignment = Alignment.Center) {
        Text(label(col), fontSize = if (names) 11.sp else 12.sp, fontWeight = if (names) FontWeight.Medium else FontWeight.Normal, color = c.mutedFg, maxLines = 1,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 4.dp))
    }
    Row {
        Box(Modifier.width(NUM_W).height(if (names) 26.dp else 24.dp).background(c.muted).border(0.5.dp, c.border))
        left.forEach { cell(it) }
        Row(Modifier.horizontalScroll(h)) { right.forEach { cell(it) } }
    }
}

@Composable
private fun GridRow(d: SheetData, s: SheetUi, store: SheetStore, r: SheetRow, left: List<SheetColumn>, right: List<SheetColumn>, h: ScrollState,
                    away: Set<Pair<String, String>>) {
    val c = Nx.colors
    val ht = rowHeight(r)
    Row {
        Box(Modifier.width(NUM_W).height(ht).background(c.muted).border(0.5.dp, c.border), contentAlignment = Alignment.Center) {
            Text("${d.rows.indexOf(r) + 1}", fontSize = 11.sp, color = c.mutedFg)
        }
        left.forEach { col -> SheetCell(d, s, store, r, col, ht, (r.id to col.id) in away) }
        Row(Modifier.horizontalScroll(h)) { right.forEach { col -> SheetCell(d, s, store, r, col, ht, (r.id to col.id) in away) } }
    }
}

/** The web's palette names for text and fill (legacy), else a hex as-is. */
private fun styleColor(v: String?): Color? {
    if (v.isNullOrBlank()) return null
    val named = mapOf("red" to 0xEF4444, "orange" to 0xF97316, "amber" to 0xF59E0B, "green" to 0x16A34A, "teal" to 0x0D9488, "blue" to 0x2563EB,
        "violet" to 0x7C3AED, "pink" to 0xDB2777, "slate" to 0x64748B, "black" to 0x111111, "rose" to 0xF43F5E, "grey" to 0x6B7280, "gray" to 0x6B7280)
    named[v.lowercase()]?.let { return Color(0xFF000000L or it.toLong()) }
    val hex = v.removePrefix("#")
    return if (hex.length == 6) hex.toLongOrNull(16)?.let { Color(0xFF000000L or it) } else null
}

private fun readableOn(bg: Color): Color = if (0.2126f * bg.red + 0.7152f * bg.green + 0.0722f * bg.blue > 0.55f) Color(0xFF111111) else Color.White

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SheetCell(d: SheetData, s: SheetUi, store: SheetStore, r: SheetRow, col: SheetColumn, ht: Dp, mergedAway: Boolean) {
    val c = Nx.colors
    val key = CellKey(r.id, col.id)
    val selected = s.selected == key
    val st: JsonObject? = r.styles[col.id]
    fun sv(k: String) = (st?.get(k) as? JsonPrimitive)?.contentOrNull
    val ri = d.rows.indexOf(r); val ci = d.columns.indexOf(col)
    val checkbox = col.type == "checkbox" || SheetRanges.isCheckbox(d.settings, ri, ci, d.shape)
    var menu by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf(false) }
    val (text, dim) = if (mergedAway) "" to false else store.text(d, r, col)
    val comp = d.computed[r.id]?.get(col.id)
    val numeric = (comp?.v as? JsonPrimitive)?.let { !it.isString && it.doubleOrNull != null } ?: ((r.cells[col.id] as? JsonPrimitive)?.let { !it.isString && it.doubleOrNull != null } ?: false)
    val bg = styleColor(sv("bg"))
    val fg = when {
        comp?.error == true -> c.dangerText
        sv("fc") != null -> styleColor(sv("fc")) ?: c.foreground
        bg != null -> readableOn(bg)
        else -> c.foreground
    }
    val ha = when (sv("ha")) { "c" -> TextAlign.Center; "r" -> TextAlign.End; "l" -> TextAlign.Start; else -> if (numeric) TextAlign.End else TextAlign.Start }
    val va = when (sv("va")) { "t" -> Alignment.TopStart; "m" -> Alignment.CenterStart; else -> Alignment.BottomStart }
    val wrap = sv("wr") == "w" || (sv("wr") == null && sv("w") == "1")
    val size = ((sv("fp")?.toFloatOrNull() ?: 10f) * 1.3f).coerceIn(9f, 28f)
    val deco = listOfNotNull(if (sv("s") == "1") TextDecoration.LineThrough else null,
        if (sv("u") == "1" || SheetCells.linkUrl(r.cells[col.id]) != null) TextDecoration.Underline else null)
    Box(Modifier.width(colWidth(col)).height(ht).background(bg ?: c.card).border(if (selected) 2.dp else 0.5.dp, if (selected) c.onyx else c.border)
        .combinedClickable(
            onClick = {
                if (!selected) store.selectCell(key)
                else if (store.canEdit() && !mergedAway) when {
                    checkbox -> store.toggle(key)
                    col.type == "select" || col.type == "multiselect" || SheetRanges.listValues(d.settings, ri, ci, d.shape) != null -> picker = true
                    else -> store.startEdit()
                }
            },
            onLongClick = { store.selectCell(key); if (store.canEdit()) menu = true },
        ).padding(horizontal = 6.dp, vertical = 3.dp), contentAlignment = va) {
        if (checkbox && !mergedAway) {
            val on = SheetCells.checked(r.cells[col.id])
            Text(if (on) "☑" else "☐", fontSize = 16.sp, color = c.foreground, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        } else if ((col.type == "select" || col.type == "multiselect") && text.isNotEmpty() && col.optionColors.isNotEmpty()) {
            val tone = styleColor(col.optionColors[text.substringBefore(", ")])
            Text(text, fontSize = 12.sp, color = tone?.let { readableOn(it.copy(alpha = 1f)) } ?: c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(tone ?: c.muted).padding(horizontal = 6.dp, vertical = 2.dp))
        } else {
            Text(text, fontSize = size.sp, color = if (dim) fg.copy(alpha = 0.5f) else fg, textAlign = ha, modifier = Modifier.fillMaxWidth(),
                fontWeight = if (sv("b") == "1") FontWeight.Bold else null, fontStyle = if (sv("i") == "1") FontStyle.Italic else null,
                textDecoration = if (deco.isEmpty()) null else TextDecoration.combine(deco),
                maxLines = if (wrap) Int.MAX_VALUE else 1, overflow = if (wrap) TextOverflow.Clip else TextOverflow.Ellipsis, softWrap = wrap)
        }
        CellMenu(menu, { menu = false }, store, key, d)
        if (picker) PickerDialog(d, col, ri, ci, r, store) { picker = false }
    }
}

/** Long-press: rows and columns around this cell, and clearing it. */
@Composable
private fun CellMenu(open: Boolean, onDismiss: () -> Unit, store: SheetStore, key: CellKey, d: SheetData) {
    DropdownMenu(open, onDismiss) {
        @Composable fun item(label: Int, danger: Boolean = false, onClick: () -> Unit) =
            DropdownMenuItem(text = { Text(stringResource(label), color = if (danger) Nx.colors.dangerText else Nx.colors.foreground) }, onClick = { onDismiss(); onClick() })
        item(R.string.sh_clear) { store.clear(key) }
        HorizontalDivider(color = Nx.colors.border)
        item(R.string.sh_row_above) { store.insertRow(key.rowId, above = true) }
        item(R.string.sh_row_below) { store.insertRow(key.rowId, above = false) }
        item(R.string.sh_row_delete, danger = true) { store.deleteRow(key.rowId) }
        HorizontalDivider(color = Nx.colors.border)
        item(R.string.sh_col_left) { store.insertColumn(key.colId, left = true) }
        item(R.string.sh_col_right) { store.insertColumn(key.colId, left = false) }
        if (d.columns.size > 1) item(R.string.sh_col_delete, danger = true) { store.deleteColumn(key.colId) }
    }
}

/** A dropdown cell: the validation list, else the column's options; a multi-select ticks several. */
@Composable
private fun PickerDialog(d: SheetData, col: SheetColumn, ri: Int, ci: Int, r: SheetRow, store: SheetStore, onDismiss: () -> Unit) {
    val values = SheetRanges.listValues(d.settings, ri, ci, d.shape) ?: col.options
    val multi = col.type == "multiselect"
    val current = SheetCells.display(col.type, r.cells[col.id], d.en).split(", ").filter { it.isNotEmpty() }.toSet()
    var picked by remember { mutableStateOf(current) }
    val key = CellKey(r.id, col.id)
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.sh_choose)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                values.forEach { v ->
                    Row(Modifier.fillMaxWidth().clickable {
                        if (multi) picked = if (v in picked) picked - v else picked + v else { onDismiss(); store.pick(key, v) }
                    }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (multi) Checkbox(v in picked, { on -> picked = if (on) picked + v else picked - v })
                        Text(v, fontSize = 15.sp, modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp))
                    }
                }
            }
        },
        confirmButton = { if (multi) TextButton(onClick = { onDismiss(); store.pick(key, values.filter { it in picked }.joinToString(", ")) }) { Text(stringResource(R.string.sh_save)) } },
        dismissButton = {
            Row {
                TextButton(onClick = { onDismiss(); store.clear(key) }) { Text(stringResource(R.string.sh_clear)) }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
            }
        })
}

// endregion

// region Edit bar

@Composable
private fun EditBar(d: SheetData, s: SheetUi, store: SheetStore) {
    val c = Nx.colors
    val k = s.selected ?: return
    val ri = d.rows.indexOfFirst { it.id == k.rowId }; val ci = d.columns.indexOfFirst { it.id == k.colId }
    if (ri < 0 || ci < 0) return
    val col = d.columns[ci]
    val raw = d.rows[ri].cells[k.colId]
    val canEdit = store.canEdit()
    Column(Modifier.fillMaxWidth().background(c.card)) {
        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(SheetFormula.colLetter(ci) + (ri + 1), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                modifier = Modifier.width(52.dp).clip(RoundedCornerShape(6.dp)).background(c.muted).padding(vertical = 8.dp), textAlign = TextAlign.Center)
            Spacer(Modifier.width(6.dp))
            val shown = s.draft ?: SheetCells.editText(col.type, raw, d.shape, d.en)
            OutlinedTextField(shown, { if (canEdit) { if (s.draft == null) store.startEdit(); store.setDraft(it) } }, singleLine = true, readOnly = !canEdit,
                placeholder = { Text(stringResource(if (canEdit) R.string.sh_type_hint else R.string.sh_view_only)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { store.commit() }),
                modifier = Modifier.weight(1f))
            if (s.draft != null) {
                IconButton(onClick = store::commit) { Icon(Icons.Filled.Check, stringResource(R.string.sh_save), tint = c.foreground) }
                IconButton(onClick = store::cancelEdit) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.mutedFg) }
            } else if (canEdit) {
                IconButton(onClick = store::undo, enabled = s.canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, stringResource(R.string.sh_undo)) }
                IconButton(onClick = store::redo, enabled = s.canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, stringResource(R.string.sh_redo)) }
            }
        }
    }
}

// endregion

