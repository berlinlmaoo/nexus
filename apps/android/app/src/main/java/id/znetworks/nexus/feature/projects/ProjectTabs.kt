package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.draw.drawBehind
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/** One read for a tab: loading → value, or the error sentence; [reload] re-runs it. */
private class Loaded<T>(val value: T?, val error: String?, val loading: Boolean)

@Composable
private fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> T): Pair<Loaded<T>, () -> Unit> {
    val res = LocalContext.current.resources
    var tick by remember { mutableIntStateOf(0) }
    var state by remember(*keys) { mutableStateOf(Loaded<T>(null, null, true)) }
    LaunchedEffect(*keys, tick) {
        state = Loaded(state.value, null, true)
        state = try { Loaded(block(), null, false) } catch (e: ApiError) { Loaded(state.value, e.describe(res), false) }
    }
    return state to { tick++ }
}

@Composable
private fun projectsApi() = ProjectsApi((LocalContext.current.applicationContext as NexusApplication).container.api)

@Composable
private fun Centered(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

@Composable
fun TabEmpty(icon: ImageVector, text: String) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(32.dp))
        Text(text, fontSize = 13.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
private fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

private fun dayLabel(iso: String?): String = dueDate(iso)?.let { AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(it) } ?: "—"

// region Spreadsheet

/** Every card (subtasks merged) as a grid, with the project's custom fields as extra columns. */
@Composable
fun SheetTab(projectId: String, lanes: List<Lane>, onOpen: (String) -> Unit) {
    val api = projectsApi()
    val c = Nx.colors
    val (fields) = rememberLoad(projectId) { api.customFields(projectId) }
    val rows = lanes.flatMap { l -> l.tasks.map { l.name to it } }
    if (rows.isEmpty()) { TabEmpty(Icons.Filled.TrackChanges, stringResource(R.string.pt_sheet_empty)); return }
    val defs = fields.value.orEmpty()
    val h = rememberScrollState()
    @Composable
    fun cell(text: String, w: Dp, header: Boolean = false, content: (@Composable () -> Unit)? = null) {
        Box(Modifier.width(w).height(if (header) 34.dp else 44.dp).padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
            if (content != null) content()
            else Text(if (header) text.uppercase(Locale.getDefault()) else text.ifBlank { "—" }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontSize = if (header) 10.sp else 12.sp, fontWeight = if (header) FontWeight.Bold else FontWeight.Normal,
                color = if (header) c.mutedFg else c.foreground.copy(alpha = 0.9f))
        }
    }
    Column(Modifier.fillMaxSize().horizontalScroll(h)) {
        Row(Modifier.background(c.muted.copy(alpha = 0.5f))) {
            cell(stringResource(R.string.pt_col_task), 210.dp, true); cell(stringResource(R.string.pt_col_section), 130.dp, true)
            cell(stringResource(R.string.pt_col_status), 110.dp, true); cell(stringResource(R.string.pt_col_priority), 100.dp, true)
            cell(stringResource(R.string.pt_col_due), 90.dp, true); cell(stringResource(R.string.pt_col_assignee), 140.dp, true)
            defs.forEach { cell(it.name, 140.dp, true) }
        }
        HorizontalDivider(color = c.border)
        LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.second.id }) { (lane, t) ->
                Row(Modifier.clickable { onOpen(t.id) }, verticalAlignment = Alignment.CenterVertically) {
                    cell("", 210.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null,
                                tint = if (t.isDone) c.success else c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text((if (t.isSubtask) "↳ " else "") + t.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                                overflow = TextOverflow.Ellipsis, color = if (t.isDone) c.mutedFg else c.foreground,
                                textDecoration = if (t.isDone) TextDecoration.LineThrough else null)
                        }
                    }
                    cell(lane, 130.dp); cell(taskStatusLabel(t.status), 110.dp); cell("", 100.dp) { PriorityChip(t.priority) }
                    cell(dayLabel(t.dueDate), 90.dp)
                    // Faces, then the names (AVATARS-PRIORITY).
                    cell(t.assignees.mapNotNull { it.user?.name }.joinToString(", "), 140.dp, content = if (t.assignees.isEmpty()) null else ({
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            id.znetworks.nexus.ui.components.AvatarStack(t.assignees.map { it.user?.name to it.user?.avatar }, size = 20.dp)
                            Spacer(Modifier.width(4.dp))
                            Text(t.assignees.mapNotNull { it.user?.name }.joinToString(", "), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                fontSize = 12.sp, color = c.foreground.copy(alpha = 0.9f))
                        }
                    }))
                    defs.forEach { f -> cell(valueText(t.customFieldValues.firstOrNull { it.customFieldId == f.id }?.value).orEmpty(), 140.dp) }
                }
                HorizontalDivider(color = c.border.copy(alpha = 0.6f))
            }
        }
    }
}

// endregion

// region Calendar

/** What the Calendar plots (DEV-REDESIGN §1, "Plot by"): the due date ([fieldId] null) or one of the project's Date fields. */
data class CalendarPlot(val fields: List<CustomFieldDef> = emptyList(), val fieldId: String? = null, val onChange: (String?) -> Unit = {})

@Composable
fun CalendarTab(tasks: List<BoardTask>, onOpen: (String) -> Unit, plot: CalendarPlot = CalendarPlot(), onCreate: (LocalDate) -> Unit) {
    val c = Nx.colors
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var selected by rememberSaveable { mutableStateOf<Int?>(null) }
    val month = YearMonth.from(OfficeTime.today()).plusMonths(offset.toLong())
    val byDay = remember(tasks, month, plot.fieldId) { BoardLogic.byDay(tasks, month) { TemplateLogic.plotDate(it, plot.fieldId) } }
    val blanks = month.atDay(1).dayOfWeek.value - 1 // Monday first
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // "Plot by": offered once the project has a Date field (Content Plan opens on "Publication date").
        if (plot.fields.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            val due = stringResource(R.string.cal_plot_due)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.cal_plot_by), fontSize = 12.sp, color = c.mutedFg)
                Box {
                    TextButton(onClick = { open = true }) { Text(plot.fields.firstOrNull { it.id == plot.fieldId }?.name ?: due, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                    androidx.compose.material3.DropdownMenu(open, { open = false }) {
                        androidx.compose.material3.DropdownMenuItem(text = { Text(due) }, onClick = { open = false; plot.onChange(null) })
                        plot.fields.forEach { f -> androidx.compose.material3.DropdownMenuItem(text = { Text(f.name) }, onClick = { open = false; plot.onChange(f.id) }) }
                    }
                }
            }
        }
        val today = OfficeTime.today()
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { offset--; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
            Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(month).replaceFirstChar(Char::titlecase),
                fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground, modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = { offset++; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) }
            // "Today" (web): back to this month with today picked.
            id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.cal_today), { offset = 0; selected = today.dayOfMonth }, compact = true)
        }
        Row {
            DayOfWeek.entries.forEach { d ->
                Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                    modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        val cells = List(blanks) { null } + (1..month.lengthOfMonth()).toList()
        cells.chunked(7).forEach { week ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                (0 until 7).forEach { i ->
                    val day = week.getOrNull(i)
                    Box(Modifier.weight(1f).height(44.dp).background(if (i >= 5) c.muted.copy(alpha = 0.4f) else Color.Transparent)) {
                        if (day != null) {
                            val on = selected == day
                            val has = byDay[day].orEmpty().isNotEmpty()
                            val isToday = month == YearMonth.from(today) && day == today.dayOfMonth
                            Column(
                                Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp))
                                    .background(if (on) c.violet else if (has) c.violet.copy(alpha = 0.08f) else Color.Transparent)
                                    .clickable { selected = day },
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                Box(Modifier.background(if (isToday) c.navy else Color.Transparent, CircleShape).padding(horizontal = 6.dp, vertical = 3.dp), contentAlignment = Alignment.Center) {
                                    Text(if (day == 1) AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(month.atDay(day)) else "$day", fontSize = 13.sp, fontWeight = if (on || isToday) FontWeight.Bold else FontWeight.Normal, color = if (isToday) c.onNavy else if (on) Color.White else c.foreground)
                                }
                                Box(Modifier.size(5.dp).background(if (!has) Color.Transparent else if (on) Color.White else c.violet, CircleShape))
                            }
                        }
                    }
                }
            }
        }
        val sel = selected
        if (sel == null) Text(stringResource(R.string.pt_cal_pick), fontSize = 12.sp, color = c.mutedFg)
        else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()).format(month.atDay(sel)), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    color = c.mutedFg, modifier = Modifier.weight(1f))
                TextButton(onClick = { onCreate(month.atDay(sel)) }) {
                    Icon(Icons.Filled.Add, null, modifier = Modifier.size(16.dp)); Text(stringResource(R.string.pt_add_task))
                }
            }
            val items = byDay[sel].orEmpty()
            if (items.isEmpty()) Text(stringResource(R.string.pt_cal_none), fontSize = 12.sp, color = c.mutedFg)
            items.forEach { t -> TaskCard(t, onClick = { onOpen(t.id) }) }
        }
        // Tasks without a date (web "No date · n"): every one as a chip that opens it, under the month.
        val undated = remember(tasks, plot.fieldId) { tasks.filter { TemplateLogic.plotDate(it, plot.fieldId) == null } }
        if (undated.isNotEmpty()) UndatedChips(undated, onOpen)
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun UndatedChips(undated: List<BoardTask>, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth().drawBehind {
        drawRoundRect(c.border, style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx()))
    }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.pt_cal_no_date, undated.size), fontSize = 12.sp, color = c.mutedFg)
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            undated.forEach { t ->
                Text(t.title.ifBlank { "—" }, fontSize = 13.sp, color = c.foreground, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 220.dp).clip(shape).border(1.dp, c.border, shape).background(c.card).clickable { onOpen(t.id) }
                        .padding(horizontal = 10.dp, vertical = 6.dp))
            }
        }
    }
}

// endregion

// region Timeline

/** Bar colour by priority (web timeline). */
private fun ganttColor(p: String?) = when (p.orEmpty().uppercase()) {
    "URGENT" -> Color(0xFFF43F5E)
    "HIGH" -> Color(0xFFF97316)
    "MEDIUM" -> Color(0xFF0EA5E9)
    "LOW" -> Color(0xFF10B981)
    else -> Color(0xFF9CA3AF)
}

/**
 * Gantt (web ProjectTimelineView): a fixed name column, 40 dp per day, today's line, opened with today one day
 * from the left edge. Undated tasks keep their row with "No date" on the track (never a bar from today).
 */
@Composable
fun TimelineTab(groups: List<Pair<String, List<BoardTask>>>, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val today = OfficeTime.today()
    // Every group, empty ones too, each collapsible (web phone timeline: "To Do" shows with nothing under it).
    var collapsed by rememberSaveable { mutableStateOf(setOf<String>()) }
    val allRows = groups.map { (name, ts) ->
        name to ts.map { it to BoardLogic.windowOrNull(it) }.sortedWith(compareBy(nullsLast()) { it.second?.start })
    }
    val rowsByGroup = allRows.map { (name, rows) -> name to if (name in collapsed) emptyList() else rows }
    if (allRows.all { it.second.isEmpty() }) {
        EmptyState(Icons.Filled.TrackChanges, stringResource(R.string.tl_empty), stringResource(R.string.tl_empty_sub), stringResource(R.string.pt_add_task), {}, Modifier.fillMaxSize())
        return
    }
    val wins = allRows.flatMap { g -> g.second.mapNotNull { it.second } }
    val minD = (wins.minOfOrNull { it.start }?.let { minOf(it, today) } ?: today).minusDays(2)
    val maxD = (wins.maxOfOrNull { it.end }?.let { maxOf(it, today) } ?: today.plusDays(14)).plusDays(3)
    val dayCount = ChronoUnit.DAYS.between(minD, maxD).toInt() + 1
    val dayW = 40.dp; val rowH = 44.dp; val groupH = 32.dp
    val leftW = (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.4f).dp.coerceIn(120.dp, 200.dp)
    fun x(d: LocalDate) = dayW * ChronoUnit.DAYS.between(minD, d).toInt()
    fun w(win: BoardLogic.Window) = dayW * (ChronoUnit.DAYS.between(win.start, win.end).toInt() + 1)
    val days = (0 until dayCount).map { minD.plusDays(it.toLong()) }
    val h = rememberScrollState()
    val density = androidx.compose.ui.platform.LocalDensity.current
    // Opens on today, one day from the left edge.
    LaunchedEffect(minD) { with(density) { h.scrollTo((x(today) - dayW).coerceAtLeast(0.dp).roundToPx()) } }
    val bodyH = 74.dp + groupH * rowsByGroup.size + rowH * rowsByGroup.sumOf { it.second.size }
    Row(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.width(leftW).background(c.card)) {
            Box(Modifier.height(74.dp).fillMaxWidth().padding(start = 12.dp, bottom = 8.dp), contentAlignment = Alignment.BottomStart) {
                Text(stringResource(R.string.pp_col_name), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
            }
            rowsByGroup.forEach { (name, rows) ->
                Row(Modifier.height(groupH).fillMaxWidth().background(c.muted.copy(alpha = 0.4f))
                    .clickable { collapsed = if (name in collapsed) collapsed - name else collapsed + name }.padding(start = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (name in collapsed) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Filled.KeyboardArrowDown, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                rows.forEach { (t, _) ->
                    // The name opens the task too: the bar may be weeks off to the right.
                    Row(Modifier.height(rowH).fillMaxWidth().clickable { onOpen(t.id) }.padding(start = if (t.isSubtask) 24.dp else 10.dp, end = 6.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null,
                            tint = if (t.isDone) c.foreground else c.mutedFg.copy(alpha = 0.45f), modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text((if (t.isSubtask) "↳ " else "") + t.title, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = if (t.isDone) c.mutedFg else c.foreground, textDecoration = if (t.isDone) TextDecoration.LineThrough else null)
                    }
                }
            }
        }
        Box(Modifier.width(1.dp).height(bodyH).background(c.border))
        Box(Modifier.weight(1f).horizontalScroll(h)) {
            Box(Modifier.width(dayW * dayCount).height(bodyH)) {
                days.filter { it.dayOfWeek == DayOfWeek.SATURDAY || it.dayOfWeek == DayOfWeek.SUNDAY }.forEach { day ->
                    Box(Modifier.offset(x = x(day), y = 74.dp).width(dayW).height(bodyH - 74.dp).background(c.muted.copy(alpha = 0.3f)))
                }
                Column(Modifier.fillMaxSize()) {
                    // Month row, then weekday + date (weekends tinted, today in a filled circle).
                    Row(Modifier.height(32.dp)) {
                        days.groupBy { YearMonth.from(it) }.forEach { (m, ds) ->
                            Box(Modifier.width(dayW * ds.size).padding(start = 6.dp), contentAlignment = Alignment.CenterStart) {
                                Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(m).replaceFirstChar(Char::titlecase),
                                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground.copy(alpha = 0.75f), maxLines = 1)
                            }
                        }
                    }
                    Row(Modifier.height(42.dp)) {
                        days.forEach { d ->
                            val isToday = d == today
                            val weekend = d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY
                            Column(Modifier.width(dayW).fillMaxHeight().background(if (weekend) c.muted.copy(alpha = 0.5f) else Color.Transparent),
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Text(d.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale.getDefault()), fontSize = 10.sp, color = c.mutedFg)
                                  Box(Modifier.size(20.dp).background(if (isToday) c.violet else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) {
                                    Text("${d.dayOfMonth}", fontSize = 11.sp, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal, color = if (isToday) c.background else c.mutedFg)
                                }
                            }
                        }
                    }
                    rowsByGroup.forEach { (_, rows) ->
                        Box(Modifier.height(groupH).fillMaxWidth().background(c.muted.copy(alpha = 0.4f)))
                        rows.forEach { (t, win) ->
                            Box(Modifier.height(rowH).fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                                if (win == null) Text(stringResource(R.string.tl_no_date), color = c.mutedFg, fontSize = 12.sp, modifier = Modifier.offset(x = with(density) { h.value.toDp() }).background(c.background).padding(horizontal = 8.dp))
                                if (win != null) Row(
                                    Modifier.offset(x = x(win.start) + 2.dp).width(maxOf(w(win) - 4.dp, dayW * 0.8f)).height(32.dp).clip(RoundedCornerShape(8.dp))
                                        .background(ganttColor(t.priority)).clickable { onOpen(t.id) }.padding(horizontal = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (t.isDone) Text("✓ ", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Color.White)
                                    if (w(win) >= 100.dp) Text(t.title, fontSize = 12.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                if (win != null && w(win) < 100.dp) Text(t.title, color = c.foreground, fontSize = 12.sp, maxLines = 1, modifier = Modifier.offset(x = x(win.start) + maxOf(w(win), dayW) + 8.dp))
                            }
                        }
                    }
                }
                // Today's line down the body, at the centre of its column.
                Box(Modifier.offset(x = x(today) + dayW / 2, y = 74.dp).width(1.dp).height(bodyH - 74.dp).background(c.violet.copy(alpha = 0.65f)))
            }
        }
    }
}

// endregion

// region Automations

// endregion

/** Pages, forms and the project chat arrive with Phase 3; until then the project opens on the web. */
@Composable
fun WebOnlyTab(icon: ImageVector, text: String, onOpenWeb: () -> Unit) {
    EmptyState(icon, text, stringResource(R.string.not_on_android_message), stringResource(R.string.open_on_web), onOpenWeb, Modifier.fillMaxSize())
}
