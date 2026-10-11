package id.znetworks.nexus.feature.projects

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

private fun dayLabel(iso: String?): String = dueDate(iso)?.let { DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()).format(it) } ?: "—"

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
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { offset--; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null) }
            Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(month).replaceFirstChar(Char::titlecase),
                fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground, modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton(onClick = { offset++; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }
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
                    Box(Modifier.weight(1f).height(44.dp)) {
                        if (day != null) {
                            val on = selected == day
                            val has = byDay[day].orEmpty().isNotEmpty()
                            Column(
                                Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp))
                                    .background(if (on) c.violet else if (has) c.violet.copy(alpha = 0.08f) else Color.Transparent)
                                    .clickable { selected = day },
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                            ) {
                                Text("$day", fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, color = if (on) Color.White else c.foreground)
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
    }
}

// endregion

// region Timeline

private fun ganttColor(p: String?) = when (p.orEmpty().uppercase()) {
    "URGENT", "HIGH" -> Color(0xFFFB7185)   // HIGH red like URGENT (owner, 10 Oct)
    "MEDIUM" -> Color(0xFF38BDF8)
    "LOW" -> Color(0xFFA78BFA)
    else -> Color(0xFF2DD4BF)
}

/** Gantt (web taskWindow): a fixed title column, a scrolling day axis, today's line. */
@Composable
fun TimelineTab(lanes: List<Lane>, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val today = OfficeTime.today()
    val groups = lanes.map { l -> l to l.tasks.map { it to BoardLogic.window(it, today) }.sortedBy { it.second.start } }.filter { it.second.isNotEmpty() }
    if (groups.isEmpty()) { TabEmpty(Icons.Filled.TrackChanges, stringResource(R.string.pt_timeline_empty)); return }
    val wins = groups.flatMap { g -> g.second.map { it.second } }
    val minD = wins.minOf { it.start }.minusDays(2)
    val maxD = wins.maxOf { it.end }.plusDays(3)
    val dayCount = ChronoUnit.DAYS.between(minD, maxD).toInt() + 1
    val dayW = 36.dp; val leftW = 130.dp; val rowH = 44.dp; val groupH = 32.dp
    fun x(d: LocalDate) = dayW * ChronoUnit.DAYS.between(minD, d).toInt()
    fun w(win: BoardLogic.Window) = dayW * (ChronoUnit.DAYS.between(win.start, win.end).toInt() + 1)
    val days = (0 until dayCount).map { minD.plusDays(it.toLong()) }
    Row(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.width(leftW).background(c.card)) {
            Box(Modifier.height(50.dp).fillMaxWidth().padding(start = 12.dp, bottom = 8.dp), contentAlignment = Alignment.BottomStart) {
                Text(stringResource(R.string.pt_col_task).uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
            }
            groups.forEach { (lane, rows) ->
                Box(Modifier.height(groupH).fillMaxWidth().background(c.muted.copy(alpha = 0.4f)).padding(start = 12.dp), contentAlignment = Alignment.CenterStart) {
                    Text(lane.name, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                rows.forEach { (t, _) ->
                    // The name opens the task too: the bar may be weeks off to the right.
                    Box(Modifier.height(rowH).fillMaxWidth().clickable { onOpen(t.id) }.padding(start = if (t.isSubtask) 20.dp else 12.dp), contentAlignment = Alignment.CenterStart) {
                        Text((if (t.isSubtask) "↳ " else "") + t.title, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = if (t.isDone) c.mutedFg else c.foreground, textDecoration = if (t.isDone) TextDecoration.LineThrough else null)
                    }
                }
            }
        }
        Box(Modifier.width(1.dp).height(50.dp + (groupH + 0.dp) * groups.size + rowH * groups.sumOf { it.second.size }).background(c.border))
        Box(Modifier.weight(1f).horizontalScroll(rememberScrollState())) {
            Column(Modifier.width(dayW * dayCount)) {
                // Month labels, then day numbers (weekends shaded, today violet).
                Row(Modifier.height(22.dp)) {
                    days.groupBy { YearMonth.from(it) }.forEach { (m, ds) ->
                        Box(Modifier.width(dayW * ds.size).padding(start = 6.dp), contentAlignment = Alignment.CenterStart) {
                            Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(m).replaceFirstChar(Char::titlecase),
                                fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.foreground.copy(alpha = 0.7f), maxLines = 1)
                        }
                    }
                }
                Row(Modifier.height(28.dp)) {
                    days.forEach { d ->
                        val isToday = d == today
                        val weekend = d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY
                        Box(Modifier.width(dayW).height(28.dp).background(if (isToday) c.violet else if (weekend) c.muted.copy(alpha = 0.4f) else Color.Transparent),
                            contentAlignment = Alignment.Center) {
                            Text("${d.dayOfMonth}", fontSize = 10.sp, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal, color = if (isToday) Color.White else c.mutedFg)
                        }
                    }
                }
                groups.forEach { (_, rows) ->
                    val gs = rows.minOf { it.second.start }; val ge = rows.maxOf { it.second.end }
                    Box(Modifier.height(groupH).fillMaxWidth().background(c.muted.copy(alpha = 0.4f)), contentAlignment = Alignment.CenterStart) {
                        Box(Modifier.offset(x = x(gs) + 3.dp).width(maxOf(w(BoardLogic.Window(gs, ge)) - 6.dp, 4.dp)).height(6.dp)
                            .background(c.mutedFg.copy(alpha = 0.3f), CircleShape))
                    }
                    rows.forEach { (t, win) ->
                        Box(Modifier.height(rowH).fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                            if (!today.isBefore(minD) && !today.isAfter(maxD)) {
                                Box(Modifier.offset(x = x(today) + dayW / 2).width(1.dp).height(rowH).background(c.violet.copy(alpha = 0.55f)))
                            }
                            Box(
                                Modifier.offset(x = x(win.start) + 3.dp).width(maxOf(w(win) - 6.dp, 16.dp)).height(22.dp).clip(RoundedCornerShape(6.dp))
                                    .background(ganttColor(t.priority)).clickable { onOpen(t.id) }.padding(start = 5.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) { if (t.isDone) Text("✓", fontSize = 10.sp, fontWeight = FontWeight.Black, color = Color.White) }
                        }
                    }
                }
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
