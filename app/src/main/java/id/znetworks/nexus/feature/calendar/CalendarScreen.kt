package id.znetworks.nexus.feature.calendar

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Everything the screen draws, derived once per state from CalendarCore (the rules live there, not here). */
class CalDerived(val s: CalState, dark: Boolean) {
    val structure = s.structure!!
    val ix = CalendarCore.indexStructure(structure.units, structure.people)
    val focus: String = s.focusId?.takeIf { ix.byId.containsKey(it) } ?: ix.top?.id ?: ""
    val atTop = ix.top?.id == focus
    val me = structure.me
    private val ctx = CalendarCore.FilterContext(ix, me?.userId, me?.homeUnitIds.orEmpty(), s.today, s.nowMs, s.windowDays)
    /** The loaded items are for the range on screen. If not, it is loading or failed: no dots, no "no tasks" (audit P1). */
    val ready = s.current
    val all = if (ready) s.items?.items.orEmpty() else emptyList()
    val filtered = CalendarCore.filterItems(all, s.filters, ctx)
    val shown = CalendarCore.underFocus(filtered, ix, focus)
    val byDay = CalendarCore.byDay(shown)
    val holidays: Map<String, String> = s.items?.holidays.orEmpty().associate { it.day to it.name }
    /** Chips for the month on screen (in People: the week). */
    val legend = CalendarCore.legend(if (s.view == CalView.MONTH) shown.filter { CalendarCore.sameMonth(it.day, s.day) } else shown, ix, focus)
    val dayItems = byDay[s.day].orEmpty()
    val tree = CalendarCore.dayTree(dayItems, ix, focus, s.today, s.nowMs, s.windowDays)
    val rail = if (s.day == s.today) CalendarCore.overdueRail(CalendarCore.underFocus(CalendarCore.filterItems(s.overdue, s.filters, ctx), ix, focus), dayItems, s.today, s.nowMs, s.windowDays) else emptyList()
    val filterCount = CalendarCore.activeFilterCount(s.filters)
    /** Cards the viewer belongs to (their home cards and everything above them). */
    val myCards: Set<String> = me?.homeUnitIds.orEmpty().flatMap { listOf(it) + ix.ancestors(it) }.toSet()
    private val dark = dark
    fun color(unitId: String?): Color {
        val u = unitId?.let(ix.byId::get) ?: return Color(0xFF64748B)
        return hex((if (dark) u.colorDark else u.color) ?: "#64748b")
    }
    fun name(userId: String): String? = ix.person[userId]?.name ?: s.items?.people?.get(userId)?.name
    fun overdue(i: CalItem) = CalendarCore.overdueState(i, s.today, s.nowMs, s.windowDays)
    /** The division a masked row is shown under ("Internal task · Finance & Tech"). */
    fun sectionName(i: CalItem): String? = i.placements.firstOrNull()?.unitId?.let { structure.sectionOf(it)?.name ?: ix.byId[it]?.name }
    companion object {
        fun hex(h: String): Color = runCatching { Color(android.graphics.Color.parseColor(h)) }.getOrDefault(Color(0xFF64748B))
    }
}

/**
 * Calendar (master calendar) — replaces Team Calendar (route `calendar`, alias `team-calendar`). Phone:
 * one LazyColumn (header → chips → month grid → day header → overdue rail → division cards); tablet
 * (≥ 600 dp): grid | day list 360 dp. People view: a week per division › person. Filters and the
 * read-only preview are full-screen (no ModalBottomSheet). Web reference d867ae2 + aa9ecdc.
 */
@Composable
fun CalendarScreen(
    onBack: () -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenMyMission: () -> Unit,
    date: String? = null, view: String? = null, lens: String? = null, focus: String? = null, scope: String? = null, task: String? = null,
    nonce: String? = null,
    vm: CalendarViewModel = viewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val config by container.remoteConfig.body.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Runs again on every return to this entry and on rotation; the VM applies a link only once.
    LaunchedEffect(date, view, lens, focus, scope, task, nonce) { vm.applyLink(date, view, lens, focus, scope, task, nonce) }
    // On show and every return to the foreground, then every calendarPollSeconds while visible (with ETag).
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) { vm.refresh(); delay(config.calendarPollSeconds * 1000L) }
        }
    }
    var filtersOpen by rememberSaveable { mutableStateOf(false) }
    val opening = s.opening
    LaunchedEffect(opening) { if (opening is CalOpen.Edit) { vm.opened(); onOpenTask(opening.taskId) } }
    val dark = c.background.luminance() < 0.5f
    // A refresh of data already on screen failed: say so, with the time of the data shown.
    val snackbar = remember { SnackbarHostState() }
    val failedText = s.loadedAt?.let { stringResource(R.string.cal_refresh_failed, loadedClock(it)) }
    LaunchedEffect(s.refreshFailures) { if (s.refreshFailures > 0 && failedText != null) snackbar.showSnackbar(failedText) }

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF0F2742)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.CalendarMonth, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.calendar_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.foreground, modifier = Modifier.weight(1f))
        }
        when {
            s.structure == null && s.error == null -> Skeleton()
            s.structure == null -> EmptyState(Icons.Filled.Refresh, stringResource(R.string.cal_load_failed), stringResource(R.string.cal_check_connection),
                stringResource(R.string.try_again), { vm.refresh() }, Modifier.fillMaxSize())
            s.access == CalAccess.NONE -> EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.cal_none_title), stringResource(R.string.cal_none_body),
                stringResource(R.string.cal_open_my_mission), onOpenMyMission, Modifier.fillMaxSize())
            s.access == CalAccess.OFF -> EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.cal_off_title), stringResource(R.string.cal_off_body),
                stringResource(R.string.cal_open_my_mission), onOpenMyMission, Modifier.fillMaxSize())
            else -> {
                val d = remember(s, dark) { CalDerived(s, dark) }
                BoxWithConstraints(Modifier.fillMaxSize()) {
                    val tablet = maxWidth >= 600.dp
                    @OptIn(ExperimentalMaterial3Api::class)
                    PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.refresh(pulled = true) }, modifier = Modifier.fillMaxSize()) {
                        if (s.view == CalView.PEOPLE) PeopleView(d, vm, tablet, onFilters = { filtersOpen = true })
                        else if (tablet) Row(Modifier.fillMaxSize()) {
                            LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                                item { Controls(d, vm) { filtersOpen = true } }
                                item { Legend(d, vm) }
                                item { MonthGrid(d, vm, Modifier.padding(horizontal = 16.dp)) }
                                item { LegendHint(d) }
                                monthNotices(d, vm)
                            }
                            Box(Modifier.width(1.dp).fillMaxHeight().background(c.border))
                            LazyColumn(Modifier.width(360.dp).fillMaxHeight(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) { dayPanel(d, vm) }
                        } else LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                            item { Controls(d, vm) { filtersOpen = true } }
                            item { Legend(d, vm) }
                            item { MonthGrid(d, vm, Modifier.padding(horizontal = 12.dp)) }
                            item { LegendHint(d) }
                            monthNotices(d, vm)
                            dayPanel(d, vm)
                        }
                    }
                }
                if (filtersOpen) FiltersScreen(d, vm) { filtersOpen = false }
            }
        }
    }
    SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding())
    }
    when (opening) {
        is CalOpen.Preview -> TaskPreview(opening.taskId, opening.projectName) { vm.opened() }
        CalOpen.Masked, CalOpen.NotFound -> MessageScreen(stringResource(if (opening == CalOpen.Masked) R.string.cal_masked_note else R.string.cal_task_failed)) { vm.opened() }
        else -> {}
    }
}

@Composable
private fun Skeleton() {
    val c = Nx.colors
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth(0.6f).height(22.dp).clip(RoundedCornerShape(8.dp)).background(c.muted))
        Box(Modifier.fillMaxWidth().height(28.dp).clip(RoundedCornerShape(14.dp)).background(c.muted))
        Box(Modifier.fillMaxWidth().height(300.dp).clip(RoundedCornerShape(16.dp)).background(c.muted))
        repeat(3) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(14.dp)).background(c.muted)) }
    }
}

@Composable
internal fun MessageScreen(text: String, onClose: () -> Unit) {
    val c = Nx.colors
    BackHandler(onBack = onClose)
    androidx.compose.ui.window.Dialog(onDismissRequest = onClose) {
        Column(Modifier.clip(RoundedCornerShape(16.dp)).background(c.card).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.Lock, null, tint = c.mutedFg); Spacer(Modifier.width(8.dp)); Text(text, fontSize = 14.sp, color = c.foreground) }
            TextButton(onClick = onClose, modifier = Modifier.align(Alignment.End)) { Text(stringResource(R.string.cal_close)) }
        }
    }
}

// ── header ─────────────────────────────────────────────────────────────────────────────────────

internal fun monthLabel(day: String): String = DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
internal fun weekLabel(day: String): String {
    val mon = LocalDate.parse(CalendarCore.mondayOf(day)); val sun = mon.plusDays(6)
    val f = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
    return "${f.format(mon)} – ${f.format(sun)} ${sun.year}"
}
internal fun longDay(day: String): String = DateTimeFormatter.ofPattern("EEEE, d MMM yyyy", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
internal fun shortDay(day: String): String = DateTimeFormatter.ofPattern("EEE d", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
/** "19.00" in Indonesian, "19:00" in English (times are WIB from the server). */
internal fun clock(time: String): String = if (Locale.getDefault().language in setOf("in", "id")) time.replace(':', '.') else time

@Composable
internal fun Controls(d: CalDerived, vm: CalendarViewModel, onFilters: () -> Unit) {
    val c = Nx.colors
    val s = d.s
    val people = s.view == CalView.PEOPLE
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { vm.shiftMonth(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(if (people) R.string.cal_prev_week else R.string.cal_prev_month)) }
            Text(if (people) weekLabel(s.day) else monthLabel(s.day), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
            IconButton(onClick = { vm.shiftMonth(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(if (people) R.string.cal_next_week else R.string.cal_next_month)) }
            Spacer(Modifier.weight(1f))
            Text(stringResource(R.string.cal_today), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                modifier = Modifier.clip(CircleShape).border(1.dp, c.border, CircleShape).clickable { vm.today() }.padding(horizontal = 12.dp, vertical = 6.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Segmented(listOf(stringResource(R.string.cal_month), stringResource(R.string.cal_people)), if (people) 1 else 0) { vm.setView(if (it == 1) CalView.PEOPLE else CalView.MONTH) }
            Spacer(Modifier.weight(1f))
            Row(Modifier.clip(CircleShape).border(1.dp, c.border, CircleShape).clickable(onClick = onFilters).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Tune, null, tint = c.foreground, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                Text(if (d.filterCount > 0) stringResource(R.string.cal_filters_n, d.filterCount) else stringResource(R.string.cal_filters), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                    color = if (d.filterCount > 0) c.violetText else c.foreground)
            }
        }
    }
}

@Composable
internal fun Segmented(options: List<String>, selected: Int, onPick: (Int) -> Unit) {
    val c = Nx.colors
    val navy = Color(0xFF1E3A5F)
    Row(Modifier.clip(RoundedCornerShape(10.dp)).background(c.muted).padding(3.dp)) {
        options.forEachIndexed { i, label ->
            val on = i == selected
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg, textAlign = TextAlign.Center,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) navy else Color.Transparent).clickable { onPick(i) }.padding(horizontal = 14.dp, vertical = 6.dp))
        }
    }
}

/** Chips per unit at the focus level (tap = zoom into a unit with children, else toggle it as a filter) and the breadcrumb. */
@Composable
internal fun Legend(d: CalDerived, vm: CalendarViewModel) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        if (!d.atTop) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.cal_all), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.violetText, modifier = Modifier.clickable { vm.focus(null) })
            (d.ix.ancestors(d.focus).reversed().drop(1) + d.focus).forEach { id ->
                Text(" › ", fontSize = 12.sp, color = c.mutedFg)
                val u = d.ix.byId[id]
                Text(u?.name ?: "", fontSize = 12.sp, fontWeight = if (id == d.focus) FontWeight.Bold else FontWeight.SemiBold,
                    color = if (id == d.focus) c.foreground else c.violetText, modifier = Modifier.clickable { vm.focus(id) })
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            d.legend.forEach { l ->
                val u = d.ix.byId[l.unitId]
                val zoom = u != null && d.ix.children[u.id].orEmpty().isNotEmpty()
                val on = l.unitId in d.s.filters.units
                Row(Modifier.clip(CircleShape).background(if (on) d.color(l.unitId).copy(alpha = 0.15f) else c.card).border(1.dp, if (on) d.color(l.unitId) else c.border, CircleShape)
                    .clickable {
                        if (u == null) return@clickable
                        if (zoom) vm.focus(u.id)
                        else vm.setFilters(d.s.filters.copy(units = if (on) d.s.filters.units - u.id else d.s.filters.units + u.id))
                    }.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(d.color(l.unitId)))
                    Spacer(Modifier.width(6.dp))
                    Text(u?.name ?: stringResource(R.string.cal_other), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                    Spacer(Modifier.width(6.dp))
                    Text("${l.count}", fontSize = 12.sp, color = c.mutedFg)
                }
            }
        }
    }
}

@Composable
private fun LegendHint(d: CalDerived) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(c.foreground)); Text(" " + stringResource(R.string.cal_legend_open) + "   ", fontSize = 11.sp, color = c.mutedFg)
        Box(Modifier.size(6.dp).clip(CircleShape).border(1.dp, c.foreground, CircleShape)); Text(" " + stringResource(R.string.cal_legend_done) + "   ", fontSize = 11.sp, color = c.mutedFg)
        Box(Modifier.width(10.dp).height(2.dp).background(c.danger)); Text(" " + stringResource(R.string.cal_legend_overdue), fontSize = 11.sp, color = c.mutedFg)
    }
}

/** Month: 6 rows × 7 cells (Monday first), dots only — up to 3 + "+", filled/ring, red bar = overdue, holidays red. */
@Composable
internal fun MonthGrid(d: CalDerived, vm: CalendarViewModel, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val s = d.s
    val days = remember(s.day) { CalendarCore.monthGrid(s.day) }
    val navy = Color(0xFF1E3A5F)
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            java.time.DayOfWeek.entries.forEach { w ->
                Text(w.getDisplayName(TextStyle.SHORT, Locale.getDefault()).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                    color = c.mutedFg, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            }
        }
        HorizontalDivider(color = c.border)
        days.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach { day ->
                    val cell = CalendarCore.dayCell(day, d.byDay[day].orEmpty(), d.ix, d.focus, s.today, s.nowMs, s.windowDays)
                    val inMonth = CalendarCore.sameMonth(day, s.day)
                    val selected = day == s.day
                    val isToday = day == s.today
                    Column(Modifier.weight(1f).heightIn(min = 52.dp).then(if (selected) Modifier.border(1.5.dp, navy, RoundedCornerShape(6.dp)) else Modifier)
                        .clickable { vm.selectDay(day) }.padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(26.dp).clip(CircleShape).background(if (isToday) navy else Color.Transparent), contentAlignment = Alignment.Center) {
                            Text(LocalDate.parse(day).dayOfMonth.toString(), fontSize = 14.sp, fontWeight = if (isToday || selected) FontWeight.Bold else FontWeight.Medium,
                                color = when { isToday -> Color.White; day in d.holidays -> c.danger; !inMonth -> c.mutedFg.copy(alpha = 0.5f); else -> c.foreground })
                        }
                        Box(Modifier.padding(top = 2.dp).width(14.dp).height(2.dp).background(if (cell.overdue && inMonth) c.danger else Color.Transparent))
                        Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                            cell.dots.take(3).forEach { dot ->
                                val col = d.color(dot.unitId.takeIf { it != CalendarCore.OTHER })
                                Box(Modifier.size(6.dp).clip(CircleShape).then(if (dot.filled) Modifier.background(col) else Modifier.border(1.dp, col, CircleShape)))
                            }
                            if (cell.dots.size > 3) Text("+", fontSize = 9.sp, color = c.mutedFg, lineHeight = 9.sp)
                        }
                    }
                }
            }
        }
    }
}

/** "14.05" / "14:05": when the data on screen was loaded, WIB. */
internal fun loadedClock(ms: Long): String = java.time.Instant.ofEpochMilli(ms).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE).let { clock("%02d:%02d".format(it.hour, it.minute)) }

/**
 * The range on screen is not loaded yet (a bar under the grid) or failed (the reason + Try again).
 * Shown instead of any "no tasks" notice: an unloaded month is not an empty one.
 */
@Composable
internal fun RangeStatus(d: CalDerived, vm: CalendarViewModel) {
    val err = d.s.rangeError
    if (err == null) LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
    else Notice(stringResource(R.string.cal_load_failed) + ". " + err, stringResource(R.string.try_again)) { vm.retry() }
}

/** Empty month, empty filters, truncated: said under the grid. */
internal fun LazyListScope.monthNotices(d: CalDerived, vm: CalendarViewModel) {
    val s = d.s
    if (!d.ready) { item(key = "rangestatus") { RangeStatus(d, vm) }; return }
    val monthItems = d.all.count { CalendarCore.sameMonth(it.day, s.day) }
    val monthShown = d.shown.count { CalendarCore.sameMonth(it.day, s.day) }
    if (s.items?.truncated == true) item { Notice(stringResource(R.string.cal_truncated), null) {} }
    if (monthItems == 0 && s.items != null) item {
        Notice(stringResource(R.string.cal_empty_month, monthLabel(s.day)), if (!CalendarCore.sameMonth(s.day, s.today)) stringResource(R.string.cal_go_this_month) else null) { vm.today() }
    } else if (monthShown == 0 && d.filterCount > 0) item {
        Notice(stringResource(R.string.cal_no_match_month), stringResource(R.string.cal_reset_filters)) { vm.setFilters(CalendarCore.NO_FILTERS) }
    }
}

@Composable
internal fun Notice(text: String, action: String?, onAction: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(text, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action, fontWeight = FontWeight.SemiBold) }
    }
}

// ── day panel ──────────────────────────────────────────────────────────────────────────────────

internal fun LazyListScope.dayPanel(d: CalDerived, vm: CalendarViewModel) {
    val s = d.s
    item(key = "dayhead") { DayHeader(d, vm) }
    if (d.rail.isNotEmpty()) item(key = "rail") { OverdueRail(d, vm) }
    if (!d.ready) {
        // Loading: placeholders where the day's cards go. Failed: the reason is under the grid already.
        if (d.s.rangeError == null) item(key = "dayskeleton") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                repeat(2) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(14.dp)).background(Nx.colors.muted)) }
            }
        }
        return
    }
    val root = d.tree.root
    if (root == null) {
        item(key = "dayempty") {
            val hidden = d.all.any { it.day == s.day } && d.filterCount > 0
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(if (hidden) R.string.cal_no_match_day else R.string.cal_no_tasks_day), fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground, textAlign = TextAlign.Center)
                Text(stringResource(if (hidden) R.string.cal_filters_hiding else R.string.cal_nobody_due), fontSize = 12.sp, color = Nx.colors.mutedFg, textAlign = TextAlign.Center)
                if (hidden) TextButton(onClick = { vm.setFilters(CalendarCore.NO_FILTERS) }) { Text(stringResource(R.string.cal_reset_filters)) }
                else if (s.day != s.today) TextButton(onClick = { vm.today() }) { Text(stringResource(R.string.cal_back_today)) }
            }
        }
        return
    }
    // The focus card's own tasks first (as a card of its own), then one card per unit under it.
    if (root.items.isNotEmpty()) item(key = "own:${root.unit.id}") { SectionCard(d, vm, CalendarCore.TreeNode(root.unit, root.items.size, root.items, root.people, root.loose, emptyList())) }
    root.children.forEach { n -> item(key = "sec:${n.unit.id}") { SectionCard(d, vm, n) } }
    if (s.lens == CalLens.PERSON && d.tree.unplaced.isNotEmpty()) item(key = "unplaced") { UnplacedCard(d, vm) }
    item(key = "total") {
        Text(stringResource(R.string.cal_unique_total, d.tree.total), fontSize = 11.sp, color = Nx.colors.mutedFg, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(16.dp))
    }
}

@Composable
private fun DayHeader(d: CalDerived, vm: CalendarViewModel) {
    val c = Nx.colors
    val s = d.s
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(longDay(s.day), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
                    val rel = when (CalendarCore.dayDiff(s.today, s.day)) { 0 -> R.string.cal_today; 1 -> R.string.cal_tomorrow; -1 -> R.string.cal_yesterday; else -> null }
                    if (rel != null) { Spacer(Modifier.width(8.dp)); Text(stringResource(rel), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White,
                        modifier = Modifier.clip(CircleShape).background(Color(0xFF1E3A5F)).padding(horizontal = 8.dp, vertical = 2.dp)) }
                }
                if (d.ready) Text(pluralStringResource(R.plurals.cal_tasks_n, d.tree.total, d.tree.total) + " · " + pluralStringResource(R.plurals.cal_people_n, d.tree.people, d.tree.people),
                    fontSize = 12.sp, color = c.mutedFg)
                d.holidays[s.day]?.let { Text(it, fontSize = 12.sp, color = c.danger) }
            }
            IconButton(onClick = { vm.selectDay(CalendarCore.addDays(s.day, -1)) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.cal_prev_day)) }
            IconButton(onClick = { vm.selectDay(CalendarCore.addDays(s.day, 1)) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.cal_next_day)) }
        }
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.weight(1f)) {
                Segmented(listOf(stringResource(R.string.cal_by_division), stringResource(R.string.cal_by_person)), if (s.lens == CalLens.PERSON) 1 else 0) {
                    vm.setLens(if (it == 1) CalLens.PERSON else CalLens.DIVISION)
                }
            }
        }
    }
}

@Composable
private fun OverdueRail(d: CalDerived, vm: CalendarViewModel) {
    val c = Nx.colors
    var all by rememberSaveable { mutableStateOf(false) }
    val list = if (all) d.rail else d.rail.take(3)
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(c.danger.copy(alpha = 0.06f))
        .border(1.dp, c.danger.copy(alpha = 0.25f), RoundedCornerShape(14.dp)).padding(12.dp)) {
        Text(stringResource(R.string.cal_overdue_n, d.rail.size).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = c.danger)
        list.forEach { TaskRow(d, it, null, vm, showDay = true) }
        if (d.rail.size > 3) TextButton(onClick = { all = !all }) { Text(stringResource(if (all) R.string.cal_show_less else R.string.cal_show_all)) }
    }
}

/** One division card: colour bar, logo/initial, name, count, "You", collapsible (remembered). */
@Composable
private fun SectionCard(d: CalDerived, vm: CalendarViewModel, n: CalendarCore.TreeNode) {
    val c = Nx.colors
    val collapsed = n.unit.id in d.s.collapsed
    val col = d.color(n.unit.id)
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))
        .drawBehind { drawRect(col, size = androidx.compose.ui.geometry.Size(4.dp.toPx(), size.height)) }) {
        Column(Modifier.weight(1f).padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth().clickable { vm.toggleCollapsed(n.unit.id) }, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)).background(col.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                    Text(n.unit.name.take(1).uppercase(), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = col)
                }
                Spacer(Modifier.width(10.dp))
                Text(n.unit.name.uppercase(Locale.getDefault()), fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = c.foreground, modifier = Modifier.weight(1f),
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (n.unit.id in d.myCards) Text(stringResource(R.string.cal_you).uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White,
                    modifier = Modifier.padding(end = 6.dp).clip(CircleShape).background(Color(0xFF1E3A5F)).padding(horizontal = 7.dp, vertical = 2.dp))
                CountPill(n.count)
                Icon(if (collapsed) Icons.Filled.ExpandMore else Icons.Filled.ExpandLess, null, tint = c.mutedFg)
            }
            if (!collapsed) NodeBody(d, vm, n, top = true)
        }
    }
}

@Composable
internal fun CountPill(n: Int) {
    val c = Nx.colors
    Text("$n", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(end = 4.dp).clip(CircleShape).background(c.muted).padding(horizontal = 8.dp, vertical = 2.dp))
}

/** A unit's content: lens "division" = its tasks; lens "person" = its people with their tasks, then tasks without a person; then sub-units. */
@Composable
private fun NodeBody(d: CalDerived, vm: CalendarViewModel, n: CalendarCore.TreeNode, top: Boolean) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(top = if (top) 6.dp else 0.dp)) {
        if (d.s.lens == CalLens.DIVISION) n.items.forEach { TaskRow(d, it, n.unit.id, vm) }
        else {
            n.people.forEach { p -> PersonBlock(d, vm, p.userId, n.unit.id, p.items) }
            n.loose.forEach { TaskRow(d, it, n.unit.id, vm) }
        }
        n.children.forEach { k ->
            if (k.unit.isGroup) {
                // Groups are thin ribbons: "CREATIVE · 1" around their cards.
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.4f))
                    .border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(10.dp)) {
                    Text("${k.unit.name.uppercase(Locale.getDefault())} · ${k.count}", fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = c.mutedFg)
                    NodeBody(d, vm, k, top = false)
                }
            } else {
                Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(3.dp).height(14.dp).background(d.color(k.unit.id)))
                        Spacer(Modifier.width(8.dp))
                        Text(k.unit.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                        Text("${k.count}", fontSize = 12.sp, color = c.mutedFg)
                    }
                    Column(Modifier.padding(start = 8.dp)) { NodeBody(d, vm, k, top = false) }
                }
            }
        }
    }
}

@Composable
private fun PersonBlock(d: CalDerived, vm: CalendarViewModel, userId: String, unitId: String?, items: List<CalItem>) {
    val c = Nx.colors
    val p = d.ix.person[userId]
    val also = p?.homeUnitIds?.filter { it != unitId }?.mapNotNull { d.ix.byId[it]?.name }.orEmpty()
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Initials(d.name(userId), d.color(unitId), 28)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(d.name(userId) ?: stringResource(R.string.cal_former_member), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (unitId == null) Text(stringResource(R.string.cal_not_in_chart_lower), fontSize = 11.sp, color = c.mutedFg)
                else if (also.isNotEmpty()) Text(stringResource(R.string.cal_also_in, also.joinToString(", ")), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            CountPill(items.size)
        }
        Column(Modifier.padding(start = 20.dp)) { items.forEach { TaskRow(d, it, unitId, vm, person = userId) } }
    }
}

@Composable
private fun UnplacedCard(d: CalDerived, vm: CalendarViewModel) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp)) {
        Text(stringResource(R.string.cal_not_in_chart_n, d.tree.unplaced.size).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = c.mutedFg)
        d.tree.unplaced.forEach { PersonBlock(d, vm, it.userId, null, it.items) }
    }
}

@Composable
internal fun Initials(name: String?, color: Color, size: Int) {
    val text = name?.trim()?.split(Regex("\\s+"))?.take(2)?.joinToString("") { it.take(1).uppercase() }?.ifEmpty { "?" } ?: "?"
    Box(Modifier.size(size.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
        Text(text, fontSize = (size * 0.36).sp, fontWeight = FontWeight.Bold, color = Color.White)
    }
}

// ── task row ───────────────────────────────────────────────────────────────────────────────────

/** Ring = to do, ✓ green = done, ! red = overdue ≤ 14 days, grey ring = older, small diamond = no status, lock = masked. */
@Composable
internal fun TaskGlyph(d: CalDerived, i: CalItem, size: Int = 18) {
    val c = Nx.colors
    val od = d.overdue(i)
    Box(Modifier.size(size.dp), contentAlignment = Alignment.Center) {
        when {
            i.masked -> Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size((size - 4).dp))
            i.noStatus -> Box(Modifier.size((size * 0.45).dp).rotate(45f).background(c.mutedFg))
            i.done -> Box(Modifier.size(size.dp).clip(CircleShape).background(c.success), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size((size - 6).dp)) }
            od == CalendarCore.Overdue.RECENT -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.8.dp, c.danger, CircleShape), contentAlignment = Alignment.Center) {
                Text("!", fontSize = (size * 0.6).sp, fontWeight = FontWeight.Bold, color = c.danger, lineHeight = (size * 0.6).sp)
            }
            od == CalendarCore.Overdue.STALE -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.5.dp, c.mutedFg.copy(alpha = 0.5f), CircleShape))
            else -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.5.dp, c.mutedFg, CircleShape))
        }
    }
}

/**
 * Task row: glyph, title (2 lines; done struck through; stale grey), time right, project dot + name
 * (+N project), URGENT/HIGH chip, "Overdue", "↳ from <parent>", the people at this unit, then "with
 * Name (Unit)". A masked row: lock + "Internal task · <division>", not clickable (decision 1).
 */
@Composable
internal fun TaskRow(d: CalDerived, i: CalItem, unitId: String?, vm: CalendarViewModel, showDay: Boolean = false, person: String? = null) {
    val c = Nx.colors
    val od = d.overdue(i)
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).then(if (i.openable) Modifier.clickable { vm.open(i) } else Modifier).padding(vertical = 8.dp),
        verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 1.dp)) { TaskGlyph(d, i) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            if (i.masked) {
                Text(d.sectionName(i)?.let { stringResource(R.string.cal_internal_in, it) } ?: stringResource(R.string.cal_internal), fontSize = 14.sp, color = c.mutedFg)
            } else {
                Text(i.title.orEmpty(), fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (i.done || od == CalendarCore.Overdue.STALE) c.mutedFg else c.foreground,
                    textDecoration = if (i.done) TextDecoration.LineThrough else null)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    i.project?.let { p ->
                        Box(Modifier.size(7.dp).clip(CircleShape).background(CalDerived.hex(p.color ?: "#64748b")))
                        Spacer(Modifier.width(5.dp))
                        Text(p.name + if (i.linkedProjectIds.isNotEmpty()) " " + pluralStringResource(R.plurals.cal_project_more, i.linkedProjectIds.size, i.linkedProjectIds.size) else "",
                            fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                    if (i.priority == "URGENT" || i.priority == "HIGH") {
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(if (i.priority == "URGENT") R.string.cal_prio_urgent else R.string.cal_prio_high).uppercase(Locale.getDefault()), fontSize = 10.sp,
                            fontWeight = FontWeight.Bold, color = c.danger, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(c.danger.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 1.dp))
                    }
                }
                if (od == CalendarCore.Overdue.RECENT) Text(stringResource(R.string.cal_overdue) + if (showDay) " · ${shortDay(i.day)}" else "", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
                if (od == CalendarCore.Overdue.STALE) Text(stringResource(R.string.cal_overdue_older, d.s.windowDays), fontSize = 12.sp, color = c.mutedFg)
                i.parent?.let { Text("↳ " + stringResource(R.string.cal_from, it.title), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            PeopleLine(d, i, unitId, person)
        }
        i.time?.let { Text(clock(it), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.padding(start = 8.dp)) }
    }
}

/** The people at this unit, then "with Name (Unit)" for the ones placed elsewhere and the ones not in the chart. */
@Composable
private fun PeopleLine(d: CalDerived, i: CalItem, unitId: String?, person: String? = null) {
    val c = Nx.colors
    // Under a person (lens "person") that person is the heading already: only the others are named.
    val here = i.placements.firstOrNull { it.unitId == unitId }?.userIds.orEmpty().filter { it != person }
    val elsewhere = i.placements.filter { it.unitId != unitId }.flatMap { p -> p.userIds.map { it to d.ix.byId[p.unitId]?.name } }.filter { it.first !in here && it.first != person }
    val outside = i.unplacedIds.filter { it != person }.map { it to null as String? }
    if (here.isEmpty() && elsewhere.isEmpty() && outside.isEmpty()) return
    Row(Modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
        here.forEach { u ->
            Initials(d.name(u), d.color(unitId), 18); Spacer(Modifier.width(4.dp))
            Text(d.name(u) ?: stringResource(R.string.cal_former_member), fontSize = 12.sp, color = c.foreground); Spacer(Modifier.width(8.dp))
        }
        if (elsewhere.isNotEmpty() || outside.isNotEmpty()) {
            Text(stringResource(R.string.cal_with) + " ", fontSize = 12.sp, color = c.mutedFg)
            (elsewhere + outside).distinctBy { it.first }.forEachIndexed { k, (u, unit) ->
                Text((if (k > 0) ", " else "") + (d.name(u) ?: stringResource(R.string.cal_former_member)) + (unit?.let { " ($it)" } ?: ""), fontSize = 12.sp, color = c.mutedFg)
            }
        }
    }
}

/** The Calendar's layout for a given state, without loading (debug screenshots from the golden files). */
@Composable
internal fun CalendarPreviewLayout(s: CalState, vm: CalendarViewModel, tablet: Boolean, filters: Boolean = false) {
    val c = Nx.colors
    val d = remember(s) { CalDerived(s, c.background.luminance() < 0.5f) }
    Column(Modifier.fillMaxSize().background(c.background)) {
        if (s.view == CalView.PEOPLE) PeopleView(d, vm, tablet, onFilters = {})
        else if (tablet) Row(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).fillMaxHeight()) { item { Controls(d, vm) {} }; item { Legend(d, vm) }; item { MonthGrid(d, vm, Modifier.padding(horizontal = 16.dp)) }; item { LegendHint(d) }; monthNotices(d, vm) }
            Box(Modifier.width(1.dp).fillMaxHeight().background(c.border))
            LazyColumn(Modifier.width(360.dp).fillMaxHeight()) { dayPanel(d, vm) }
        } else LazyColumn(Modifier.fillMaxSize()) {
            item { Controls(d, vm) {} }; item { Legend(d, vm) }; item { MonthGrid(d, vm, Modifier.padding(horizontal = 12.dp)) }; item { LegendHint(d) }; monthNotices(d, vm); dayPanel(d, vm)
        }
    }
    if (filters) FiltersScreen(d, vm) {}
}
