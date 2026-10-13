package id.znetworks.nexus.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.calendar.CalendarGlance.Quadrant
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The whole list behind a quadrant widget (audit #40: "+N more" used to lead nowhere, and these lists
 * live in widgets alone — decision 7). Route `calendar-list?q=do|plan|act|later&scope=me|division|all`,
 * from `nexus://calendar?view=quadrant&q=&scope=`. Same snapshot and rules as the widget (CalendarGlance):
 * it starts from the snapshot the widget drew (so it works offline) and refreshes in place. A task opens
 * directly (task screen or read-only preview), so Back comes back here (audit 2 #17).
 */
@Composable
fun CalendarQuadrantScreen(q: String?, scope: String?, onBack: () -> Unit, onOpenDay: (day: String?, scope: String) -> Unit,
                           onOpenTask: (String) -> Unit, onOpenPreview: (String, String?) -> Unit) {
    val c = Nx.colors
    val quadrant = Quadrant.of(q) ?: Quadrant.DO
    val glanceScope = GlanceScope.entries.firstOrNull { it.wire == scope } ?: GlanceScope.ME
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    var snapshot by remember { mutableStateOf<CalGlance?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    val snackbar = remember { SnackbarHostState() }
    val scopeRef = rememberCoroutineScope()
    val gone = stringResource(R.string.cal_task_gone)
    val offline = stringResource(R.string.cal_task_offline)
    LaunchedEffect(attempt) {
        failed = false
        if (snapshot == null) snapshot = container.calendarSnapshots.load(glanceScope)?.snapshot
        runCatching { container.calendar.glance(glanceScope).value }.onSuccess { snapshot = it }.onFailure { failed = snapshot == null }
    }
    /** Edit → task screen, else the read-only preview; masked → its day; gone/offline → said in a snackbar. */
    fun open(b: CalendarGlance.Bar) {
        val id = b.id
        if (b.masked || id == null) { onOpenDay(b.day, glanceScope.wire); return }
        scopeRef.launch {
            val r = runCatching { container.calendar.task(id) }.getOrNull()
            when {
                r == null -> snackbar.showSnackbar(offline)
                !r.found -> snackbar.showSnackbar(gone)
                r.masked -> onOpenDay(b.day, glanceScope.wire)
                r.canEdit && r.editProjectId != null && r.editProjectId == r.projectId -> onOpenTask(id)
                else -> onOpenPreview(id, b.project)
            }
        }
    }
    val title = stringResource(when (quadrant) { Quadrant.DO -> R.string.wcal_q_do; Quadrant.PLAN -> R.string.wcal_q_plan; Quadrant.ACT -> R.string.wcal_q_act; Quadrant.LATER -> R.string.wcal_q_later })
    val note = when (quadrant) { Quadrant.ACT -> R.string.wcal_q_act_note; Quadrant.LATER -> R.string.wcal_q_later_note; else -> null }
    val scopeLabel = stringResource(when (glanceScope) { GlanceScope.DIVISION -> R.string.wcal_scope_division; GlanceScope.ALL -> R.string.wcal_scope_all; else -> R.string.wcal_scope_me })
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides c.foreground) {
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Column(Modifier.weight(1f)) {
                Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, style = CalType.s18, color = c.foreground, modifier = Modifier.semantics { heading() })
                Text(listOfNotNull(note?.let { stringResource(it) }, scopeLabel).joinToString(" · "), style = CalType.s12, color = c.mutedFg)
            }
        }
        val s = snapshot
        when {
            s == null && !failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s == null -> EmptyState(Icons.Filled.CloudOff, stringResource(R.string.cal_load_failed), stringResource(R.string.cal_check_connection),
                stringResource(R.string.try_again), { attempt++ }, Modifier.fillMaxSize())
            else -> {
                val now = System.currentTimeMillis()
                val list = CalendarGlance.quadrants(s, now).first { it.quadrant == quadrant }
                val today = CalendarGlance.wibClock(now).day
                if (list.rows.isEmpty()) EmptyState(Icons.Filled.TaskAlt,
                    stringResource(when (quadrant) { Quadrant.DO -> R.string.wcal_q_do_empty; Quadrant.PLAN -> R.string.wcal_q_plan_empty; Quadrant.ACT -> R.string.wcal_q_act_empty; Quadrant.LATER -> R.string.wcal_q_later_empty }, scopeLabel),
                    stringResource(R.string.calq_empty_next), stringResource(R.string.calq_open_calendar), { onOpenDay(null, glanceScope.wire) }, Modifier.fillMaxSize())
                else LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                    item { Text(stringResource(R.string.calq_title_note), style = CalType.s12, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                    items(list.rows, key = { it.key }) { b -> QuadrantRow(b, today) { open(b) } }
                }
            }
        }
    }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding())
    }
    }
}

@Composable
private fun QuadrantRow(b: CalendarGlance.Bar, today: String, onClick: () -> Unit) {
    val c = Nx.colors
    val col = projectColor(b.color)
    val day = b.day?.let { d ->
        when (d) {
            today -> stringResource(R.string.wcal_today); CalendarGlance.addDays(today, 1) -> stringResource(R.string.wcal_tomorrow)
            else -> DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()).format(LocalDate.parse(d))
        } + (b.time?.let { " · " + clock(it) } ?: "")
    } ?: stringResource(R.string.wcal_no_due)
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).height(36.dp).clip(RoundedCornerShape(2.dp)).background(if (b.overdue == CalendarGlance.Overdue.RECENT) c.danger else col))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (b.masked) { Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
                Text(if (b.masked || b.title == null) stringResource(R.string.cal_internal) else b.title, style = CalType.s15, fontWeight = FontWeight.Medium, color = c.foreground,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(listOfNotNull(day, b.project?.takeIf { !b.masked }, if (b.overdue == CalendarGlance.Overdue.RECENT) stringResource(R.string.cal_overdue) else null).joinToString(" · "),
                style = CalType.s12, color = if (b.overdue == CalendarGlance.Overdue.RECENT) c.dangerText else c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        b.priority?.takeIf { it == "URGENT" || it == "HIGH" }?.let {
            Box(Modifier.size(8.dp).clip(CircleShape).background(c.danger))
        }
    }
}
