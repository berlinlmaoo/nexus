package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.i18n.AppDateFormats

import id.znetworks.nexus.ui.theme.NightHues
import androidx.compose.ui.platform.LocalDensity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Today
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle as UiTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.admin.orgchart.UnitLogo
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.NexusTypography
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.runtime.snapshotFlow
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * The Calendar's type roles, from NexusTypography (Inter body, Plus Jakarta titles) with line heights that
 * match their size — hand-set sizes used to inherit bodyLarge's 24 sp line and 0.5 sp tracking (audit 3 #3).
 * Weight and colour stay per call; the role brings family, size, line height and tracking.
 */
internal object CalType {
    val s9 = NexusTypography.labelSmall.copy(fontSize = 9.sp, lineHeight = 12.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.2.sp)
    val s11 = NexusTypography.labelSmall.copy(fontWeight = FontWeight.Normal)
    val s12 = NexusTypography.bodySmall
    val s13 = NexusTypography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 18.sp)
    val s14 = NexusTypography.bodyMedium
    val s15 = NexusTypography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = 0.15.sp)
    val s16 = NexusTypography.titleMedium.copy(lineHeight = 22.sp)
    val s18 = NexusTypography.titleMedium.copy(fontSize = 18.sp, lineHeight = 24.sp)
    val s22 = NexusTypography.titleLarge.copy(fontSize = 22.sp, lineHeight = 28.sp)
}

/** A project's colour as drawn now: its own hex by day, lightened to 3:1 at night (audit 3 #7, as the widgets). */
@Composable
internal fun projectColor(hex: String?): Color =
    if (Nx.colors.background.luminance() < 0.5f) NightHues.night(hex, emptyMap()) else NightHues.day(hex)

/** The one style for uppercase micro-labels in the Calendar (audit 2, contract 6): Inter, with its own line height (audit 3 #3). */
internal val MicroLabel = NexusTypography.labelSmall.copy(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp)

// ── Derived data, split by what it depends on (audit #18) ───────────────────────────────────────

/** The Bagan, indexed once per structure; division colours parsed once. */
@Immutable
class CalIndex(val structure: CalStructure, private val dark: Boolean) {
    val ix = CalendarCore.indexStructure(structure.units, structure.people)
    val me = structure.me
    /** Cards the viewer belongs to (their home cards and everything above them). */
    val myCards: Set<String> = me?.homeUnitIds.orEmpty().flatMap { listOf(it) + ix.ancestors(it) }.toSet()
    val inChart = me?.homeUnitIds.orEmpty().isNotEmpty()
    private val colors = HashMap<String, Color>()
    fun color(unitId: String?): Color {
        val u = unitId?.let(ix.byId::get) ?: return NEUTRAL
        return colors.getOrPut(u.id) { hex((if (dark) u.colorDark else u.color) ?: "#64748b") }
    }
    /** The division a masked row is shown under ("Internal task · Finance & Tech"). */
    fun sectionName(i: CalItem): String? = i.placements.firstOrNull()?.unitId?.let { structure.sectionOf(it)?.name ?: ix.byId[it]?.name }
    companion object {
        val NEUTRAL = Color(0xFF64748B)
        fun hex(h: String): Color = runCatching { Color(android.graphics.Color.parseColor(h)) }.getOrDefault(NEUTRAL)
    }
}

/** Items of the range through the filters and the zoom; the month's cells, the legend. Not keyed on UI-only state. */
@Immutable
class CalData(val index: CalIndex, val s: CalState) {
    val ix = index.ix
    val focus: String = s.focusId?.takeIf { ix.byId.containsKey(it) } ?: ix.top?.id ?: ""
    val atTop = ix.top?.id == focus
    private val ctx = CalendarCore.FilterContext(ix, index.me?.userId, index.me?.homeUnitIds.orEmpty(), s.today, s.nowMs, s.windowDays)
    /** The loaded items are for the range on screen. If not, it is loading or failed: no dots, no "no tasks" (audit P1). */
    val ready = s.current
    val all = if (ready) s.items?.items.orEmpty() else emptyList()
    val shown = CalendarCore.underFocus(CalendarCore.filterItems(all, s.filters, ctx), ix, focus)
    val byDay = CalendarCore.byDay(shown)
    val holidays: Map<String, String> = s.items?.holidays.orEmpty().associate { it.day to it.name }
    /** Chips for the month on screen (in People: the week). */
    val legend = CalendarCore.legend(if (s.view == CalView.MONTH) shown.filter { CalendarCore.sameMonth(it.day, s.day) } else shown, ix, focus)
    val grid = CalendarCore.monthGrid(s.day)
    val cells: Map<String, CalendarCore.DayCell> = grid.associateWith { CalendarCore.dayCell(it, byDay[it].orEmpty(), ix, focus, s.today, s.nowMs, s.windowDays) }
    val overdueByDay: Map<String, Int> = byDay.mapValues { (_, l) -> l.count { CalendarCore.overdueState(it, s.today, s.nowMs, s.windowDays) == CalendarCore.Overdue.RECENT } }
    /** Filters only: the scope (Everyone / Mine / My division) is a view, never counted (contract 2). */
    val filterCount = CalendarCore.activeFilterCount(s.filters.copy(scope = CalendarCore.Scope.ALL))
    val monthShown = shown.count { CalendarCore.sameMonth(it.day, s.day) }
    private val filteredOverdue by lazy { CalendarCore.underFocus(CalendarCore.filterItems(s.overdue, s.filters, ctx), ix, focus) }
    fun rail(dayItems: List<CalItem>) = if (s.day == s.today) CalendarCore.overdueRail(filteredOverdue, dayItems, s.today, s.nowMs, s.windowDays) else emptyList()
}

/** One flattened row of the day panel (audit #19): each is its own lazy item. */
sealed interface PanelRow {
    val key: String
    data class Card(override val key: String, val node: CalendarCore.TreeNode, val collapsed: Boolean, val mine: Boolean) : PanelRow
    data class Sub(override val key: String, val unit: CalUnit, val count: Int, val depth: Int, val cardUnit: String) : PanelRow
    data class Person(override val key: String, val userId: String, val unitId: String?, val count: Int, val depth: Int, val cardUnit: String?, val me: Boolean) : PanelRow
    data class Task(override val key: String, val item: CalItem, val unitId: String?, val person: String?, val depth: Int, val cardUnit: String?, val last: Boolean) : PanelRow
    data class End(override val key: String, val cardUnit: String?) : PanelRow
    data class UnplacedHead(override val key: String, val count: Int) : PanelRow
    /** Consecutive masked rows of one place, as one line: "4 internal tasks · Budi, Gita" (audit 2 #26). */
    data class MaskedGroup(override val key: String, val items: List<CalItem>, val unitId: String?, val depth: Int, val cardUnit: String?) : PanelRow
}

/** The selected day: its tree, the rail, and the panel rows for the lens. */
@Immutable
class CalDay(val data: CalData, day: String, lens: CalLens, collapsed: Set<String>) {
    val s = data.s
    val dayItems = data.byDay[day].orEmpty()
    val tree = CalendarCore.dayTree(dayItems, data.ix, data.focus, s.today, s.nowMs, s.windowDays)
    val rail = data.rail(dayItems)
    val rows: List<PanelRow> = buildRows(lens, collapsed)

    private fun buildRows(lens: CalLens, collapsed: Set<String>): List<PanelRow> {
        val root = tree.root ?: return emptyList()
        val me = data.index.me?.userId
        val out = mutableListOf<PanelRow>()
        fun people(n: CalendarCore.TreeNode): List<CalendarCore.PersonRow> =
            // The viewer first, tagged "You" (audit #33); the rest in the Bagan's order.
            n.people.sortedBy { if (it.userId == me) 0 else 1 }
        fun body(n: CalendarCore.TreeNode, depth: Int, card: String) {
            if (lens == CalLens.DIVISION) n.items.forEach { out += PanelRow.Task("t:$card:${n.unit.id}:${it.key}", it, n.unit.id, null, depth, card, false) }
            else {
                people(n).forEach { p ->
                    out += PanelRow.Person("p:$card:${n.unit.id}:${p.userId}", p.userId, n.unit.id, p.items.size, depth, card, p.userId == me)
                    p.items.forEach { out += PanelRow.Task("t:$card:${n.unit.id}:${p.userId}:${it.key}", it, n.unit.id, p.userId, depth + 1, card, false) }
                }
                n.loose.forEach { out += PanelRow.Task("t:$card:${n.unit.id}:-:${it.key}", it, n.unit.id, null, depth, card, false) }
            }
            n.children.forEach { k ->
                out += PanelRow.Sub("s:$card:${k.unit.id}", k.unit, k.count, depth, card)
                body(k, depth + 1, card)
            }
        }
        fun card(n: CalendarCore.TreeNode, own: Boolean) {
            val key = if (own) "own:${n.unit.id}" else "sec:${n.unit.id}"
            val closed = n.unit.id in collapsed
            out += PanelRow.Card(key, n, closed, n.unit.id in data.index.myCards)
            if (!closed) {
                if (own) {
                    if (lens == CalLens.DIVISION) n.items.forEach { out += PanelRow.Task("t:$key:${it.key}", it, n.unit.id, null, 0, key, false) }
                    else {
                        people(n).forEach { p ->
                            out += PanelRow.Person("p:$key:${p.userId}", p.userId, n.unit.id, p.items.size, 0, key, p.userId == me)
                            p.items.forEach { out += PanelRow.Task("t:$key:${p.userId}:${it.key}", it, n.unit.id, p.userId, 1, key, false) }
                        }
                        n.loose.forEach { out += PanelRow.Task("t:$key:-:${it.key}", it, n.unit.id, null, 0, key, false) }
                    }
                } else body(n, 0, key)
            }
            out += PanelRow.End("e:$key", key)
        }
        // The focus card's own tasks first (as a card of its own), then one card per unit under it.
        if (root.items.isNotEmpty() || (lens == CalLens.PERSON && (root.people.isNotEmpty() || root.loose.isNotEmpty())))
            card(CalendarCore.TreeNode(root.unit, root.items.size, root.items, root.people, root.loose, emptyList()), own = true)
        root.children.forEach { card(it, own = false) }
        if (lens == CalLens.PERSON && tree.unplaced.isNotEmpty()) {
            out += PanelRow.UnplacedHead("unplaced", tree.unplaced.size)
            tree.unplaced.sortedBy { if (it.userId == me) 0 else 1 }.forEach { p ->
                out += PanelRow.Person("p:unplaced:${p.userId}", p.userId, null, p.items.size, 0, "unplaced", p.userId == me)
                p.items.forEach { out += PanelRow.Task("t:unplaced:${p.userId}:${it.key}", it, null, p.userId, 1, "unplaced", false) }
            }
            out += PanelRow.End("e:unplaced", "unplaced")
        }
        return group(out)
    }

    /** Runs of 2+ masked task rows in the same place become one MaskedGroup. */
    private fun group(rows: List<PanelRow>): List<PanelRow> {
        val out = mutableListOf<PanelRow>()
        var run = mutableListOf<PanelRow.Task>()
        fun flush() {
            if (run.size >= 2) out += PanelRow.MaskedGroup("m:" + run.first().key, run.map { it.item }, run.first().unitId, run.first().depth, run.first().cardUnit)
            else out += run
            run = mutableListOf()
        }
        for (r in rows) {
            val same = r is PanelRow.Task && r.item.masked && run.firstOrNull()?.let { it.unitId == r.unitId && it.person == r.person && it.cardUnit == r.cardUnit } != false
            if (same) run += r as PanelRow.Task else { flush(); out += r }
        }
        flush()
        return out
    }
}

/** Everything the screen draws: the three remembered parts behind one handle. */
class CalDerived(val s: CalState, val index: CalIndex, val data: CalData, val dayPart: CalDay) {
    val ix get() = index.ix
    val focus get() = data.focus
    val atTop get() = data.atTop
    val me get() = index.me
    val ready get() = data.ready
    val all get() = data.all
    val shown get() = data.shown
    val byDay get() = data.byDay
    val holidays get() = data.holidays
    val legend get() = data.legend
    val filterCount get() = data.filterCount
    val myCards get() = index.myCards
    val tree get() = dayPart.tree
    val rail get() = dayPart.rail
    fun color(unitId: String?) = index.color(unitId)
    fun name(userId: String): String? = ix.person[userId]?.name ?: s.items?.people?.get(userId)?.name
    fun overdue(i: CalItem) = CalendarCore.overdueState(i, s.today, s.nowMs, s.windowDays)
    fun sectionName(i: CalItem) = index.sectionName(i)
    companion object { fun hex(h: String) = CalIndex.hex(h) }
}

/** The three parts, each remembered on exactly what it reads: opening, refreshing and the like rebuild nothing. */
@Composable
internal fun rememberDerived(s: CalState, dark: Boolean): CalDerived? {
    val structure = s.structure ?: return null
    val index = remember(structure, dark) { CalIndex(structure, dark) }
    val data = remember(index, s.items, s.itemsRange, s.overdue, s.filters, s.focusId, s.range, s.view, s.day.substring(0, 7), s.day == s.today) { CalData(index, s) }
    val day = remember(data, s.day, s.lens, s.collapsed) { CalDay(data, s.day, s.lens, s.collapsed) }
    // The same handle while nothing it exposes changed: polls, opening a task or a refresh flag skip every row (audit 2 #21).
    return remember(index, data, day, s.filters, s.day, s.view, s.lens, s.collapsed, s.offline, s.loadedAt, s.rangeError, s.divisionFallback, s.railAll, s.hintSeen) {
        CalDerived(s, index, data, day)
    }
}

/** Window size classes (audit #11): compact < 600, medium 600–839, expanded ≥ 840 (and tall enough for two panes). */
enum class CalLayout { COMPACT, MEDIUM, EXPANDED }

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Calendar (master calendar) — replaces Team Calendar (route `calendar`, alias `team-calendar`). Compact
 * and medium: one list (header → controls → chips → month grid → day header → overdue rail → division
 * cards, each row its own lazy item). Expanded: grid | day list (40 %, 360–420 dp). People view: a week
 * per division › person. Filters show in place (side panel when expanded), never as a dialog; the
 * read-only preview is its own route. Web reference d867ae2 + aa9ecdc; audit "impeccable" 6 Oct.
 */
@Composable
fun CalendarScreen(
    onBack: () -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenMyMission: () -> Unit,
    date: String? = null, view: String? = null, lens: String? = null, focus: String? = null, scope: String? = null, task: String? = null,
    nonce: String? = null,
    onOpenPreview: (String, String?) -> Unit = { _, _ -> },
    vm: CalendarViewModel = viewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
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
    val opening = s.opening
    LaunchedEffect(opening) {
        when (opening) {
            is CalOpen.Edit -> { vm.opened(); onOpenTask(opening.taskId) }
            is CalOpen.Preview -> { vm.opened(); onOpenPreview(opening.taskId, opening.projectName) }
            else -> {}
        }
    }
    CalendarContent(s, vm, onBack, onOpenMyMission)
    // A task that no longer exists: a dialog that says so, no connection icon (audit 2 #25).
    if (opening == CalOpen.Gone) AlertDialog(onDismissRequest = { vm.opened() },
        text = { Text(stringResource(R.string.cal_task_gone)) },
        confirmButton = { TextButton(onClick = { vm.opened() }) { Text(stringResource(R.string.cal_close)) } })
}

/** The screen for a state: shared by the live screen and the debug preview. */
@Composable
internal fun CalendarContent(s: CalState, vm: CalendarViewModel, onBack: () -> Unit, onOpenMyMission: () -> Unit, filtersInitially: Boolean = false) {
    val c = Nx.colors
    val dark = c.background.luminance() < 0.5f
    var filtersOpen by rememberSaveable { mutableStateOf(filtersInitially) }
    // A refresh of data already on screen failed: say so, with the time of the data shown.
    val snackbar = remember { SnackbarHostState() }
    val failedText = s.loadedAt?.let { stringResource(R.string.cal_refresh_failed, loadedClock(it)) }
    LaunchedEffect(s.refreshFailures) { if (s.refreshFailures > 0 && failedText != null) snackbar.showSnackbar(failedText) }
    // Masked: the reason, once, in a snackbar — not a dialog (audit 2 #26). Offline: the reason with Retry (audit 2 #25).
    val maskedNote = stringResource(R.string.cal_masked_note)
    val offlineNote = stringResource(R.string.cal_task_offline)
    val retry = stringResource(R.string.try_again)
    LaunchedEffect(s.opening) {
        when (val o = s.opening) {
            CalOpen.Masked -> { vm.opened(); snackbar.showSnackbar(maskedNote, withDismissAction = true) }
            is CalOpen.Offline -> { vm.opened(); if (snackbar.showSnackbar(offlineNote, actionLabel = retry, withDismissAction = true) == SnackbarResult.ActionPerformed) vm.openById(o.taskId) }
            else -> {}
        }
    }
    val d = rememberDerived(s, dark)
    // Back zooms out before it leaves the Calendar (audit #32).
    BackHandler(enabled = !filtersOpen && d != null && !d.atTop) { vm.focus(d?.ix?.ancestors(d.focus)?.firstOrNull()) }

    // Icons and text default to the theme's foreground (no Surface here): visible in dark mode too.
    CompositionLocalProvider(LocalContentColor provides c.foreground) {
    BoxWithConstraints(Modifier.fillMaxSize().background(c.background)) {
        val shortHeight = maxHeight < 480.dp
        val layout = when {
            maxWidth >= 840.dp && !shortHeight -> CalLayout.EXPANDED
            // A phone on its side: height is the scarce axis, so grid | day side by side (audit 2 #7).
            maxWidth >= 600.dp && shortHeight -> CalLayout.EXPANDED
            maxWidth >= 600.dp -> CalLayout.MEDIUM
            else -> CalLayout.COMPACT
        }
        // Expanded shows two panes; a third (grid | day | filters) only from 1200 dp (M3 large), otherwise
        // the filters take the day pane's place (audit 2 #1). Widths come from what is actually left.
        val threePanes = layout == CalLayout.EXPANDED && filtersOpen && maxWidth >= 1200.dp
        val filtersWidth = 400.dp
        val calendarWidth = if (filtersOpen && layout == CalLayout.EXPANDED) maxWidth - filtersWidth - 1.dp else maxWidth
        val panelWidth = (calendarWidth * 0.4f).coerceIn(320.dp, 420.dp)
        Row(Modifier.fillMaxSize()) {
            // Filters replace the screen on compact and medium; a side panel when expanded (audit #12, #24).
            if (!filtersOpen || layout == CalLayout.EXPANDED) Column(Modifier.weight(1f).fillMaxHeight()) {
                Header(d, onBack, onToday = { vm.today() }, onFilters = { filtersOpen = !filtersOpen })
                when {
                    d == null && s.error == null -> Skeleton()
                    d == null -> EmptyState(Icons.Filled.Refresh, stringResource(R.string.cal_load_failed), stringResource(R.string.cal_check_connection),
                        stringResource(R.string.try_again), { vm.refresh() }, Modifier.fillMaxSize())
                    // A personal-workspace account joins the company's workspace with its code (owner, 16 Oct 2026).
                    s.access == CalAccess.NONE -> {
                        var joining by remember { mutableStateOf(false) }
                        EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.cal_none_title), stringResource(R.string.cal_none_body),
                            stringResource(R.string.ws_join_enter_code), { joining = true }, Modifier.fillMaxSize())
                        if (joining) JoinWorkspaceDialog(onDismiss = { joining = false }, onJoined = { joining = false; vm.refresh() })
                    }
                    s.access == CalAccess.OFF -> EmptyState(Icons.Filled.CalendarMonth, stringResource(R.string.cal_off_title), stringResource(R.string.cal_off_body),
                        stringResource(R.string.cal_open_my_tasks), onOpenMyMission, Modifier.fillMaxSize())
                    else -> {
                        @OptIn(ExperimentalMaterial3Api::class)
                        PullToRefreshBox(isRefreshing = s.refreshing, onRefresh = { vm.refresh(pulled = true) }, modifier = Modifier.fillMaxSize()) {
                            if (s.view == CalView.PEOPLE) PeopleView(d, vm, tablet = layout != CalLayout.COMPACT, onFilters = { filtersOpen = true })
                            else if (layout == CalLayout.EXPANDED) TwoPane(d, vm, panelWidth, showDay = !filtersOpen || threePanes, shortHeight = shortHeight, dayRequests = s.dayRequests)
                            else OnePane(d, vm, medium = layout == CalLayout.MEDIUM, shortHeight = shortHeight, dayRequests = s.dayRequests)
                        }
                    }
                }
            }
            if (filtersOpen && d != null) {
                if (layout == CalLayout.EXPANDED) VerticalDivider(color = c.border)
                FiltersScreen(d, vm, if (layout == CalLayout.EXPANDED) Modifier.width(filtersWidth).fillMaxHeight() else Modifier.fillMaxSize(), sidePanel = layout == CalLayout.EXPANDED) { filtersOpen = false }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding())
    }
    }
}

/** Back, title, Today and Filters (with a count) as icon buttons, like the app's other screens (audit #45). */
@Composable
private fun Header(d: CalDerived?, onBack: () -> Unit, onToday: () -> Unit, onFilters: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        Text(stringResource(R.string.calendar_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, style = CalType.s18, color = c.foreground,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).semantics { heading() })
        if (d != null) {
            IconButton(onClick = onToday) { Icon(Icons.Filled.Today, stringResource(R.string.cal_today)) }
            val n = d.filterCount
            IconButton(onClick = onFilters) {
                BadgedBox(badge = { if (n > 0) Badge { Text("$n") } }) {
                    Icon(Icons.Filled.Tune, if (n > 0) pluralStringResource(R.plurals.cal_filters_on, n, n) else stringResource(R.string.cal_filters))
                }
            }
        }
    }
}

/**
 * After the person asks for a day (cell, Today, day arrows) — and once on the first open on today — bring
 * the day header into view, then move focus to it so its live region announces the day (audit 2 #3, #12).
 */
@Composable
private fun RevealDay(d: CalDerived, dayRequests: Int, list: LazyListState, head: Int, focus: FocusRequester, animate: Boolean) {
    var firstOpenDone by rememberSaveable { mutableStateOf(false) }
    suspend fun reveal() {
        if (animate) list.animateScrollToItem(head) else list.scrollToItem(head)
        withTimeoutOrNull(1_000) { snapshotFlow { list.layoutInfo.visibleItemsInfo.any { it.key == "dayhead" } }.first { it } }
        runCatching { focus.requestFocus() }
    }
    // [dayRequests] comes straight from the live state: the remembered handle `d` is not keyed on it, so
    // Today or a tap on the selected day (same day, nothing else changed) would read a stale count (audit 3 #2).
    LaunchedEffect(dayRequests) { if (dayRequests > 0) reveal() }
    // The first open starts at the top like iOS / the web (run 5, 14 Oct 2026): the month grid with its division
    // dots and legend, then the day below. It used to jump past them to today's tasks.
    LaunchedEffect(d.ready) { if (d.ready && !firstOpenDone) firstOpenDone = true }
}

/** Compact and medium: one list; medium caps it at 680 dp so day cells still get titles (audit 2 #20). */
@Composable
private fun OnePane(d: CalDerived, vm: CalendarViewModel, medium: Boolean, shortHeight: Boolean, dayRequests: Int) {
    val list = rememberLazyListState()
    val dayFocus = remember { FocusRequester() }
    val showHint = !shortHeight
    val head = remember(d.data, showHint, d.filterCount) { 4 + (if (showHint) 1 else 0) + noticeKeys(d.data).size }
    RevealDay(d, dayRequests, list, head, dayFocus, animate = true)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.fillMaxHeight().then(if (medium) Modifier.widthIn(max = 680.dp) else Modifier.fillMaxWidth()), state = list,
            contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "controls") { Controls(d, vm) }
            item(key = "active") { ActiveFilters(d, vm) }
            item(key = "legend") { Legend(d, vm) }
            item(key = "grid") { MonthGrid(d.data, d.index, d.s.day, d.s.today, Modifier.padding(horizontal = 12.dp)) { vm.selectDay(it, reveal = true) } }
            if (showHint) item(key = "hint") { LegendHint(d.s.hintSeen) }
            monthNotices(d, vm)
            dayPanel(d, vm, dayFocus)
        }
    }
}

/**
 * Expanded: grid | day list. Each pane is its own traversal group; picking a day shows the day list from
 * its top and moves focus there (audit #8, audit 2 #3). With filters open below 1200 dp the day pane gives
 * its place to the filters (audit 2 #1).
 */
@Composable
private fun TwoPane(d: CalDerived, vm: CalendarViewModel, panelWidth: Dp, showDay: Boolean, shortHeight: Boolean, dayRequests: Int) {
    val c = Nx.colors
    val dayFocus = remember { FocusRequester() }
    val panel = rememberLazyListState()
    RevealDay(d, dayRequests, panel, 0, dayFocus, animate = false)
    Row(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).fillMaxHeight().semantics { isTraversalGroup = true }, contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "controls") { Controls(d, vm, shortHeight = shortHeight) }
            item(key = "active") { ActiveFilters(d, vm) }
            item(key = "legend") { Legend(d, vm) }
            item(key = "grid") { MonthGrid(d.data, d.index, d.s.day, d.s.today, Modifier.padding(horizontal = 16.dp), cellMin = if (shortHeight) 40.dp else 52.dp) { vm.selectDay(it, reveal = true) } }
            if (!shortHeight) item(key = "hint") { LegendHint(d.s.hintSeen) }
            monthNotices(d, vm)
        }
        if (showDay) {
            VerticalDivider(color = c.border)
            LazyColumn(Modifier.width(panelWidth).fillMaxHeight().semantics { isTraversalGroup = true }, state = panel, contentPadding = PaddingValues(bottom = 24.dp)) {
                dayPanel(d, vm, dayFocus)
            }
        }
    }
}

@Composable
private fun Skeleton() {
    val c = Nx.colors
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.fillMaxWidth(0.6f).height(22.dp).clip(RoundedCornerShape(8.dp)).background(c.muted))
        Box(Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(20.dp)).background(c.muted))
        Box(Modifier.fillMaxWidth().height(300.dp).clip(RoundedCornerShape(16.dp)).background(c.muted))
        repeat(3) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(14.dp)).background(c.muted)) }
    }
}

// ── header ─────────────────────────────────────────────────────────────────────────────────────

internal fun monthLabel(day: String): String = DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
/** "14–20 Sep 2026", or "28 Sep – 4 Oct 2026" across a month (short enough for 360 dp, audit #43). */
internal fun weekLabel(day: String): String {
    val mon = LocalDate.parse(CalendarCore.mondayOf(day)); val sun = mon.plusDays(6)
    val l = Locale.getDefault()
    return if (mon.month == sun.month) "${mon.dayOfMonth}–${AppDateFormats.ofPattern("d MMM yyyy", l).format(sun)}"
    else "${AppDateFormats.ofPattern("d MMM", l).format(mon)} – ${AppDateFormats.ofPattern("d MMM yyyy", l).format(sun)}"
}
internal fun longDay(day: String): String = AppDateFormats.ofPattern("EEEE, d MMM yyyy", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
internal fun shortDay(day: String): String = DateTimeFormatter.ofPattern("EEE d", Locale.getDefault()).format(LocalDate.parse(day)).replaceFirstChar { it.titlecase(Locale.getDefault()) }
/** "19.00" in Indonesian, "19:00" in English (times are WIB from the server). */
internal fun clock(time: String): String = if (Locale.getDefault().language in setOf("in", "id")) time.replace(':', '.') else time

/** "14.05" / "14:05": when the data on screen was loaded, WIB. */
internal fun loadedClock(ms: Long): String = java.time.Instant.ofEpochMilli(ms).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE).let { clock("%02d:%02d".format(it.hour, it.minute)) }

/**
 * One row: ‹ period › and the Month | People switch (icons, labelled for TalkBack); then the scope —
 * Everyone · Mine · My division — shown once (contract 2). Fewer rows above the grid (audit 2 #12).
 */
@Composable
internal fun Controls(d: CalDerived, vm: CalendarViewModel, shortHeight: Boolean = false) {
    val c = Nx.colors
    val s = d.s
    val people = s.view == CalView.PEOPLE
    val label = if (people) weekLabel(s.day) else monthLabel(s.day)
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
        // Narrow or large text: the view switch gets its own row and the period may wrap, so "October 2026"
        // or "14–20 Sep 2026" is never cut (audit 3 #1). A phone on its side keeps everything in one row and
        // the scope in a menu, so the grid gets the height (audit 3 #4).
        val roomy = maxWidth >= 600.dp && fontScale <= 1.15f // inner width: a 411 dp phone fits one row, a 360 dp one does not
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.shiftMonth(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(if (people) R.string.cal_prev_week else R.string.cal_prev_month)) }
                Column(Modifier.weight(1f)) {
                    Text(label, style = CalType.s16, color = c.foreground, maxLines = 2, modifier = Modifier.semantics { heading() })
                    // Not confirmed by the server right now: say how old it is (audit #21).
                    if (s.offline && s.loadedAt != null) Text(stringResource(R.string.cal_updated_offline, loadedClock(s.loadedAt)), style = CalType.s12, color = c.mutedFg, maxLines = 1)
                }
                IconButton(onClick = { vm.shiftMonth(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(if (people) R.string.cal_next_week else R.string.cal_next_month)) }
                if (roomy || shortHeight) ViewSwitch(s.view) { vm.setView(it) }
                if (shortHeight) { Spacer(Modifier.width(8.dp)); ScopeMenu(d, vm) }
            }
            if (!roomy && !shortHeight) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { ViewSwitch(s.view) { vm.setView(it) } }
            if (!shortHeight) {
                // The scope, shown once (contract 2). "My division" without a Bagan card is Mine with a note (contract 3).
                Choice(listOf(stringResource(R.string.cal_everyone), stringResource(R.string.cal_mine), stringResource(R.string.cal_my_division)), s.filters.scope.ordinal) {
                    vm.setScope(CalendarCore.Scope.entries[it], inChart = d.index.inChart)
                }
            }
            if (s.divisionFallback) Text(stringResource(R.string.cal_not_in_chart_scope), style = CalType.s12, color = c.mutedFg)
        }
    }
}

/** Month | People: icons labelled for TalkBack; the selected one shows M3's check in its place (audit 3 #6). */
@Composable
private fun ViewSwitch(view: CalView, onPick: (CalView) -> Unit) {
    id.znetworks.nexus.ui.components.Segmented(listOf(CalView.MONTH to stringResource(R.string.cal_month), CalView.PEOPLE to stringResource(R.string.cal_people)), view, onPick)

}

/** The scope as a compact menu (a phone on its side): still shown once, still a view (contract 2). */
@Composable
private fun ScopeMenu(d: CalDerived, vm: CalendarViewModel) {
    var open by remember { mutableStateOf(false) }
    val names = listOf(stringResource(R.string.cal_everyone), stringResource(R.string.cal_mine), stringResource(R.string.cal_my_division))
    Box {
        OutlinedButton(onClick = { open = true }) { Text(names[d.s.filters.scope.ordinal], maxLines = 1); Icon(Icons.Filled.ExpandMore, null) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            names.forEachIndexed { i, n ->
                DropdownMenuItem(text = { Text(n) }, onClick = { open = false; vm.setScope(CalendarCore.Scope.entries[i], inChart = d.index.inChart) },
                    leadingIcon = { if (i == d.s.filters.scope.ordinal) Icon(Icons.Filled.Check, null) })
            }
        }
    }
}

/**
 * The filters in force, each removable with its × — always visible, even for a person or project with no
 * task in the range on screen (audit 2 #16). The scope is not here (contract 2).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ActiveFilters(d: CalDerived, vm: CalendarViewModel) {
    val f = d.s.filters
    if (d.filterCount == 0) return
    val chips = activeFilterChips(d)
    FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.forEach { (label, remove) ->
            val removeLabel = stringResource(R.string.cal_remove_filter, label)
            InputChip(selected = true, onClick = { vm.setFilters(remove(f)) }, label = { Text(label, maxLines = 1) },
                trailingIcon = { Icon(Icons.Filled.Close, null, Modifier.size(InputChipDefaults.IconSize)) },
                modifier = Modifier.semantics { contentDescription = removeLabel })
        }
    }
}

/** Every active filter as (label, how to remove it). Names for ids not in the range come from the Bagan, else a generic word. */
@Composable
internal fun activeFilterChips(d: CalDerived): List<Pair<String, (CalendarCore.Filters) -> CalendarCore.Filters>> {
    val f = d.s.filters
    val projects = (d.s.items?.items.orEmpty() + d.s.overdue).mapNotNull { it.project }.associate { it.id to it.name }
    val out = mutableListOf<Pair<String, (CalendarCore.Filters) -> CalendarCore.Filters>>()
    f.units.forEach { id -> out += (d.ix.byId[id]?.name ?: stringResource(R.string.cal_no_division)) to { x -> x.copy(units = x.units - id) } }
    f.people.forEach { id -> out += (d.name(id) ?: stringResource(R.string.cal_former_member)) to { x -> x.copy(people = x.people - id) } }
    f.projects.forEach { id -> out += (projects[id] ?: stringResource(R.string.cal_project_elsewhere)) to { x -> x.copy(projects = x.projects - id) } }
    val prio = mapOf("URGENT" to R.string.cal_prio_urgent, "HIGH" to R.string.cal_prio_high, "MEDIUM" to R.string.cal_prio_medium, "LOW" to R.string.cal_prio_low, "NONE" to R.string.cal_prio_none)
    f.priorities.forEach { k -> out += stringResource(prio[k] ?: R.string.cal_prio_medium) to { x -> x.copy(priorities = x.priorities - k) } }
    if (f.hideDone) out += stringResource(R.string.cal_hide_done) to { x -> x.copy(hideDone = false) }
    if (f.overdueOnly) out += stringResource(R.string.cal_only_overdue) to { x -> x.copy(overdueOnly = false) }
    return out
}

/**
 * An M3 single-choice segmented button row: role and selected state for TalkBack, 48 dp targets (audit #3).
 * The selected segment shows M3's check and a container apart from the surface with a violet border, so the
 * state is not carried by colour alone (audit 2 #9). Labels use the M3 style and may wrap at large font sizes.
 */
@Composable
internal fun Choice(options: List<String>, selected: Int, modifier: Modifier = Modifier.fillMaxWidth(), enabled: (Int) -> Boolean = { true }, onPick: (Int) -> Unit) {
    val c = Nx.colors
    Row(modifier.clip(RoundedCornerShape(12.dp)).background(c.muted).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEachIndexed { i, label ->
            Box(Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (i == selected) c.card else Color.Transparent)
                .selectable(selected = i == selected, enabled = enabled(i), role = Role.RadioButton) { onPick(i) }.heightIn(min = 48.dp).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                Text(label, color = if (i == selected) c.foreground else c.mutedFg, fontSize = 13.sp, textAlign = TextAlign.Center, maxLines = 2)
            }
        }
    }

}

/**
 * Chips per unit at the focus level and the breadcrumb. A unit with children zooms (chevron); a leaf
 * filters (selected chip). Each says which it does (audit #32).
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
internal fun Legend(d: CalDerived, vm: CalendarViewModel) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        if (!d.atTop) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { vm.focus(null) }) { Text(stringResource(R.string.cal_all_divisions)) }
            (d.ix.ancestors(d.focus).reversed().drop(1) + d.focus).forEach { id ->
                Text("›", color = c.mutedFg, modifier = Modifier.clearAndSetSemantics {})
                val u = d.ix.byId[id]
                TextButton(onClick = { vm.focus(id) }, enabled = id != d.focus) {
                    Text(u?.name ?: "", fontWeight = if (id == d.focus) FontWeight.Bold else FontWeight.Medium, color = if (id == d.focus) c.foreground else c.violetText)
                }
            }
        }
        androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            d.legend.forEach { l ->
                val u = d.ix.byId[l.unitId]
                val focusable = u != null && d.ix.children[u.id].orEmpty().isNotEmpty()
                val on = l.unitId in d.s.filters.units
                val name = u?.name ?: stringResource(R.string.cal_no_division)
                if (focusable) {
                    // Focus (not a filter): a button chip with the focus icon (contract 1, audit 2 #14).
                    val spoken = pluralStringResource(R.plurals.cal_focus_on_n, l.count, name, l.count)
                    AssistChip(onClick = { vm.focus(u!!.id) },
                        label = { Text("$name  ${l.count}", maxLines = 1) },
                        leadingIcon = { Box(Modifier.size(8.dp).clip(CircleShape).background(d.color(l.unitId))) },
                        trailingIcon = { Icon(Icons.Filled.CenterFocusStrong, null, Modifier.size(AssistChipDefaults.IconSize)) },
                        modifier = Modifier.semantics { contentDescription = spoken })
                } else {
                    val spoken = stringResource(R.string.cal_filter_by, name) + ", " + pluralStringResource(R.plurals.cal_tasks_n, l.count, l.count)
                    FilterChip(selected = on,
                        onClick = { if (u != null) vm.setFilters(d.s.filters.copy(units = if (on) d.s.filters.units - u.id else d.s.filters.units + u.id)) },
                        label = { Text("$name  ${l.count}", maxLines = 1) },
                        leadingIcon = { Box(Modifier.size(8.dp).clip(CircleShape).background(d.color(l.unitId))) },
                        modifier = Modifier.semantics { contentDescription = spoken })
                }
            }
        }
    }
}

/** The dot key, always (contract 5: the grid's code stays readable); the focus hint until focus has been used once (audit 2 #12). */
@Composable
private fun LegendHint(hintSeen: Boolean) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        // Wraps at large font sizes instead of scrolling out of sight (audit 3 #2).
        FlowRow(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(12.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(6.dp).clip(CircleShape).background(c.foreground)); Text(" " + stringResource(R.string.cal_legend_open), style = CalType.s12, color = c.mutedFg) }
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(painterResource(R.drawable.ic_cal_check), null, tint = c.foreground, modifier = Modifier.size(12.dp)); Text(" " + stringResource(R.string.cal_legend_done), style = CalType.s12, color = c.mutedFg) }
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.width(10.dp).height(2.dp).background(c.danger)); Text(" " + stringResource(R.string.cal_legend_overdue), style = CalType.s12, color = c.mutedFg) }
        }
        if (!hintSeen) Text(stringResource(R.string.cal_legend_hint), style = CalType.s12, color = c.mutedFg, modifier = Modifier.padding(top = 2.dp))
    }
}

/**
 * Month: 6 rows × 7 cells (Monday first). Dots — up to 3 + "+", full dot (to do) / small check (all done or no status, rule 10.31) — or, in wide cells, up to 2
 * titles. Red bar = overdue, Sundays and holidays red, today a navy disc. Each cell speaks its day, tasks,
 * overdue and holiday, and says it is selected (audit #1).
 */
@Composable
internal fun MonthGrid(data: CalData, index: CalIndex, selectedDay: String, today: String, modifier: Modifier = Modifier, cellMin: Dp = 52.dp, onPick: (String) -> Unit) {
    val c = Nx.colors
    val ready = data.ready
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).clearAndSetSemantics {}) {
            java.time.DayOfWeek.entries.forEach { w ->
                Text(w.getDisplayName(TextStyle.SHORT, Locale.getDefault()).uppercase(Locale.getDefault()), style = MicroLabel, maxLines = 1, softWrap = false,
                    autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = 7.sp, maxFontSize = 12.sp, stepSize = 0.5.sp),
                    color = if (w == java.time.DayOfWeek.SUNDAY) c.dangerText else c.mutedFg, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val titles = maxWidth / 7 >= 90.dp
            Column {
                data.grid.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        week.forEach { day -> DayCell(data, index, day, day == selectedDay, day == today, titles && ready, cellMin, onPick) }
                    }
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.DayCell(data: CalData, index: CalIndex, day: String, selected: Boolean, isToday: Boolean, titles: Boolean, cellMin: Dp, onPick: (String) -> Unit) {
    val c = Nx.colors
    val cell = data.cells[day]
    val inMonth = CalendarCore.sameMonth(day, data.s.day)
    val holiday = data.holidays[day]
    val sunday = CalendarCore.mondayIndex(day) == 6
    val count = data.byDay[day]?.size ?: 0
    val overdue = data.overdueByDay[day] ?: 0
    val parts = listOfNotNull(
        longDay(day),
        if (isToday) stringResource(R.string.cal_today) else null,
        if (data.ready) (if (count == 0) stringResource(R.string.cal_no_tasks) else pluralStringResource(R.plurals.cal_tasks_n, count, count)) else null,
        if (overdue > 0) pluralStringResource(R.plurals.cal_overdue_count, overdue, overdue) else null,
        holiday,
    )
    val description = parts.joinToString(", ")
    val showLabel = stringResource(R.string.cal_show_tasks)
    Column(Modifier.weight(1f).heightIn(min = if (titles) 76.dp else cellMin)
        .then(if (selected) Modifier.border(1.5.dp, c.navy, RoundedCornerShape(6.dp)) else Modifier)
        .semantics(mergeDescendants = true) { contentDescription = description; this.selected = selected }
        .clickable(onClickLabel = showLabel, role = Role.Button) { onPick(day) }.padding(vertical = 5.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.sizeIn(minWidth = 26.dp, minHeight = 26.dp).clip(CircleShape).background(if (isToday) c.navy else Color.Transparent).padding(horizontal = 3.dp)
            .clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
            Text(LocalDate.parse(day).dayOfMonth.toString(), maxLines = 1, softWrap = false,
                style = UiTextStyle(fontSize = 14.sp, lineHeight = 14.sp, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both)),
                fontWeight = if (isToday || selected) FontWeight.Bold else FontWeight.Medium,
                color = when {
                    isToday -> c.onNavy
                    // Sundays red like holidays, as on the widgets (audit #46).
                    holiday != null || sunday -> if (inMonth) c.dangerText else c.dangerText.copy(alpha = 0.8f)
                    !inMonth -> c.mutedFg
                    else -> c.foreground
                })
        }
        Box(Modifier.padding(top = 2.dp).width(14.dp).height(2.dp).background(if (cell?.overdue == true && inMonth) c.danger else Color.Transparent))
        if (titles) {
            Column(Modifier.fillMaxWidth().padding(top = 2.dp).clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                val list = data.byDay[day].orEmpty()
                list.take(2).forEach { i ->
                    val col = index.color(i.placements.firstOrNull()?.unitId).let { if (inMonth) it else it.copy(alpha = it.alpha * QUIET_OUT_OF_MONTH) }
                    Text(if (i.masked) stringResource(R.string.cal_internal) else i.title.orEmpty(), style = CalType.s11, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (i.done) c.mutedFg else c.foreground, textDecoration = if (i.done) TextDecoration.LineThrough else null,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(col.copy(alpha = 0.14f)).padding(horizontal = 4.dp, vertical = 1.dp))
                }
                if (list.size > 2) Text("+${list.size - 2}", style = CalType.s11, color = c.mutedFg)
            }
        } else Row(Modifier.padding(top = 3.dp).clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
            cell?.dots.orEmpty().take(3).forEach { dot ->
                // One dot per division present that day; a neighbouring month's day shows its dots quieter (still tappable, iOS / web QA 13 Oct).
                val col = index.color(dot.unitId.takeIf { it != CalendarCore.OTHER }).let { if (inMonth) it else it.copy(alpha = it.alpha * QUIET_OUT_OF_MONTH) }
                // Rule 10.31 (owner, 8 Oct): a full dot = still something to do; a small check in the division's colour = all done / no status.
                if (dot.filled) Box(Modifier.size(6.dp).clip(CircleShape).background(col))
                else Icon(painterResource(R.drawable.ic_cal_check), null, tint = col, modifier = Modifier.size(10.dp))
            }
            if ((cell?.dots?.size ?: 0) > 3) Text("+", style = CalType.s9, color = c.mutedFg, lineHeight = 9.sp)
        }
    }
}

/** How much quieter a neighbouring month's dots and chips are (they stay tappable). */
internal const val QUIET_OUT_OF_MONTH = 0.45f

/** What monthNotices will show, in order (also counts the items before the day header). */
internal fun noticeKeys(data: CalData): List<String> {
    val s = data.s
    if (!data.ready) return listOf("rangestatus")
    val out = mutableListOf<String>()
    if (s.items?.truncated == true) out += "truncated"
    val monthItems = data.all.count { CalendarCore.sameMonth(it.day, s.day) }
    if (s.view == CalView.MONTH) {
        if (monthItems == 0 && s.items != null) out += "emptymonth"
        else if (data.monthShown == 0 && data.filterCount > 0) out += "nomatch"
    }
    return out
}

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

/** Loading or failed range, truncated, empty month, empty filters: said under the grid. */
internal fun LazyListScope.monthNotices(d: CalDerived, vm: CalendarViewModel) {
    val s = d.s
    noticeKeys(d.data).forEach { k ->
        when (k) {
            "rangestatus" -> item(key = k) { RangeStatus(d, vm) }
            "truncated" -> item(key = k) { Notice(stringResource(R.string.cal_truncated), null) {} }
            "emptymonth" -> item(key = k) {
                Notice(stringResource(R.string.cal_empty_month, monthLabel(s.day)), if (!CalendarCore.sameMonth(s.day, s.today)) stringResource(R.string.cal_go_this_month) else null) { vm.today() }
            }
            "nomatch" -> item(key = k) { Notice(stringResource(R.string.cal_no_match_month), stringResource(R.string.cal_reset_filters)) { vm.resetFilters() } }
        }
    }
}

@Composable
internal fun Notice(text: String, action: String?, onAction: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = CalType.s13, color = c.foreground, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action, fontWeight = FontWeight.SemiBold) }
    }
}

// ── day panel ──────────────────────────────────────────────────────────────────────────────────

/** The day: header, overdue rail (today), then every card row as its own lazy item (audit #19). */
internal fun LazyListScope.dayPanel(d: CalDerived, vm: CalendarViewModel, headFocus: FocusRequester? = null) {
    val s = d.s
    item(key = "dayhead") { DayHeader(d, vm, headFocus) }
    if (d.rail.isNotEmpty()) overdueRail(d, vm)
    if (!d.ready) {
        // Loading: placeholders where the day's cards go. Failed: the reason is under the grid already.
        if (s.rangeError == null) item(key = "dayskeleton") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                repeat(2) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(14.dp)).background(Nx.colors.muted)) }
            }
        }
        return
    }
    if (d.tree.root == null || d.dayPart.rows.isEmpty()) {
        item(key = "dayempty") {
            val hidden = d.all.any { it.day == s.day } && d.filterCount > 0
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(if (hidden) R.string.cal_no_match_day else R.string.cal_no_tasks_day), fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground, textAlign = TextAlign.Center)
                Text(stringResource(if (hidden) R.string.cal_filters_hiding else R.string.cal_nobody_due), style = CalType.s12, color = Nx.colors.mutedFg, textAlign = TextAlign.Center)
                if (hidden) TextButton(onClick = { vm.resetFilters() }) { Text(stringResource(R.string.cal_reset_filters)) }
                else if (s.day != s.today) TextButton(onClick = { vm.today() }) { Text(stringResource(R.string.cal_back_today)) }
            }
        }
        return
    }
    items(d.dayPart.rows, key = { it.key }, contentType = { it::class }) { r -> PanelRowView(d, vm, r) }
    item(key = "total") {
        Text(stringResource(R.string.cal_unique_total, d.tree.total), style = CalType.s12, color = Nx.colors.mutedFg, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(16.dp))
    }
}

/** Date (a heading that announces itself when the day changes, audit #8), relative chip, counts, holiday; lens switch. */
@Composable
private fun DayHeader(d: CalDerived, vm: CalendarViewModel, focus: FocusRequester?) {
    val c = Nx.colors
    val s = d.s
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).then(if (focus != null) Modifier.focusRequester(focus).focusable() else Modifier)
                .semantics(mergeDescendants = true) { heading(); liveRegion = LiveRegionMode.Polite }) {
                Text(longDay(s.day), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, style = CalType.s18, color = c.foreground)
                // The relative chip sits on the line below, so a long date never crushes it at 360 dp (audit #43).
                val rel = when (CalendarCore.dayDiff(s.today, s.day)) { 0 -> R.string.cal_today; 1 -> R.string.cal_tomorrow; -1 -> R.string.cal_yesterday; else -> null }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                    if (rel != null) {
                        Text(stringResource(rel), style = CalType.s12, fontWeight = FontWeight.Bold, color = c.onNavy,
                            modifier = Modifier.clip(CircleShape).background(c.navy).padding(horizontal = 8.dp, vertical = 2.dp))
                        Spacer(Modifier.width(8.dp))
                    }
                    if (d.ready) Text(pluralStringResource(R.plurals.cal_tasks_n, d.tree.total, d.tree.total) + " · " + pluralStringResource(R.plurals.cal_people_n, d.tree.people, d.tree.people),
                        style = CalType.s12, color = c.mutedFg)
                }
                d.holidays[s.day]?.let { Text(it, style = CalType.s12, color = c.dangerText) }
            }
            IconButton(onClick = { vm.selectDay(CalendarCore.addDays(s.day, -1), reveal = true) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.cal_prev_day)) }
            IconButton(onClick = { vm.selectDay(CalendarCore.addDays(s.day, 1), reveal = true) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.cal_next_day)) }
        }
        Choice(listOf(stringResource(R.string.cal_by_division), stringResource(R.string.cal_by_person)), if (s.lens == CalLens.PERSON) 1 else 0) {
            vm.setLens(if (it == 1) CalLens.PERSON else CalLens.DIVISION)
        }
    }
}

/** Today's overdue (≤ 14 days): a header, the first three or all, "Show all/less" — every row its own lazy item (audit 2 #22). */
private fun LazyListScope.overdueRail(d: CalDerived, vm: CalendarViewModel) {
    val rows = if (d.s.railAll) d.rail else d.rail.take(3)
    item(key = "rail") {
        val c = Nx.colors
        Text(stringResource(R.string.cal_overdue_n, d.rail.size).uppercase(Locale.getDefault()), style = MicroLabel, color = c.dangerText,
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp).clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .background(c.danger.copy(alpha = 0.06f)).padding(start = 12.dp, end = 12.dp, top = 12.dp).semantics { heading() })
    }
    items(rows, key = { "r:" + it.key }, contentType = { "railrow" }) { i ->
        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).background(Nx.colors.danger.copy(alpha = 0.06f)).padding(horizontal = 12.dp)) {
            TaskRow(d, i, null, vm, showDay = true, inCard = false)
        }
    }
    item(key = "railend") {
        val c = Nx.colors
        Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 6.dp).clip(RoundedCornerShape(bottomStart = 14.dp, bottomEnd = 14.dp))
            .background(c.danger.copy(alpha = 0.06f)).padding(horizontal = 4.dp)) {
            if (d.rail.size > 3) TextButton(onClick = { vm.toggleRail() }) { Text(stringResource(if (d.s.railAll) R.string.cal_show_less else R.string.cal_show_all)) }
            else Spacer(Modifier.height(8.dp))
        }
    }
}

/** A row of a division card. Cards are drawn in pieces: top (header), sides (rows), bottom (end). */
@Composable
private fun PanelRowView(d: CalDerived, vm: CalendarViewModel, r: PanelRow) {
    val c = Nx.colors
    when (r) {
        is PanelRow.Card -> CardHeader(d, vm, r)
        is PanelRow.End -> Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(12.dp).cardPiece(d, r.cardUnit, top = false, bottom = true)) {}
        is PanelRow.UnplacedHead -> Text(stringResource(R.string.cal_not_in_chart_n, r.count).uppercase(Locale.getDefault()), style = MicroLabel, color = c.mutedFg,
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp).cardPiece(d, "unplaced", top = true, bottom = false).padding(16.dp).semantics { heading() })
        is PanelRow.Sub -> Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).cardPiece(d, r.cardUnit, top = false, bottom = false)) {
            if (r.unit.isGroup) Text("${r.unit.name.uppercase(Locale.getDefault())} · ${r.count}", style = MicroLabel, color = c.mutedFg,
                modifier = Modifier.padding(start = (16 + 12 * r.depth).dp, end = 16.dp, top = 10.dp, bottom = 2.dp).semantics { heading() })
            else Row(Modifier.padding(start = (16 + 12 * r.depth).dp, end = 16.dp, top = 10.dp).semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).height(14.dp).background(d.color(r.unit.id)))
                Spacer(Modifier.width(8.dp))
                Text(r.unit.name, style = CalType.s13, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                Text("${r.count}", style = CalType.s12, color = c.mutedFg)
            }
        }
        is PanelRow.Person -> Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).cardPiece(d, r.cardUnit, top = false, bottom = false)) {
            PersonHead(d, r, Modifier.padding(start = (16 + 12 * r.depth).dp, end = 16.dp, top = 8.dp))
        }
        is PanelRow.MaskedGroup -> Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).cardPiece(d, r.cardUnit, top = false, bottom = false)) {
            Box(Modifier.padding(start = (16 + 12 * r.depth).dp, end = 12.dp)) { MaskedGroupRow(d, vm, r) }
        }
        is PanelRow.Task -> Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).cardPiece(d, r.cardUnit, top = false, bottom = false)) {
            Box(Modifier.padding(start = (16 + 12 * r.depth).dp, end = 12.dp)) { TaskRow(d, r.item, r.unitId, vm, person = r.person, inCard = r.cardUnit != null && r.cardUnit != "unplaced") }
        }
    }
}

/** One slice of a card: background, side borders, the colour bar; top and bottom slices round and close it. */
private fun Modifier.cardPiece(d: CalDerived, cardKey: String?, top: Boolean, bottom: Boolean): Modifier = composed {
    val c = Nx.colors
    val unit = cardKey?.substringAfter(':')?.takeIf { cardKey != "unplaced" }
    val bar = if (unit != null) d.color(unit) else Color.Transparent
    val shape = RoundedCornerShape(topStart = if (top) 16.dp else 0.dp, topEnd = if (top) 16.dp else 0.dp, bottomStart = if (bottom) 16.dp else 0.dp, bottomEnd = if (bottom) 16.dp else 0.dp)
    Modifier.clip(shape).background(c.card).drawBehind {
        val w = 1.dp.toPx()
        drawRect(c.border, Offset(0f, 0f), Size(w, size.height)); drawRect(c.border, Offset(size.width - w, 0f), Size(w, size.height))
        if (top) drawRect(c.border, Offset(0f, 0f), Size(size.width, w))
        if (bottom) drawRect(c.border, Offset(0f, size.height - w), Size(size.width, w))
        drawRect(bar, Offset(0f, 0f), Size(4.dp.toPx(), size.height))
    }
}

/** Card header: logo (or initial), name, "You", count, collapse — a heading that says whether it is open (audit #9, #27). */
@Composable
private fun CardHeader(d: CalDerived, vm: CalendarViewModel, r: PanelRow.Card) {
    val c = Nx.colors
    val n = r.node
    val col = d.color(n.unit.id)
    val state = stringResource(if (r.collapsed) R.string.cal_collapsed else R.string.cal_expanded)
    val action = stringResource(if (r.collapsed) R.string.cal_expand else R.string.cal_collapse)
    Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp).cardPiece(d, r.key, top = true, bottom = false)) {
        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) { heading(); stateDescription = state }
            .clickable(onClickLabel = action) { vm.toggleCollapsed(n.unit.id) }.heightIn(min = 48.dp).padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.clearAndSetSemantics {}) {
                UnitLogo(n.unit.logoUrl, n.unit.name, 26, RoundedCornerShape(7.dp)) {
                    Box(Modifier.size(26.dp).clip(RoundedCornerShape(7.dp)).background(col.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                        Text(n.unit.name.take(1).uppercase(), style = CalType.s12, fontWeight = FontWeight.Bold, color = col)
                    }
                }
            }
            Spacer(Modifier.width(10.dp))
            Text(n.unit.name.uppercase(Locale.getDefault()), style = MicroLabel, color = c.foreground, modifier = Modifier.weight(1f),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (r.mine) Text(stringResource(R.string.cal_you).uppercase(Locale.getDefault()), style = CalType.s11, fontWeight = FontWeight.Bold, color = c.onNavy,
                modifier = Modifier.padding(end = 6.dp).clip(CircleShape).background(c.navy).padding(horizontal = 7.dp, vertical = 2.dp))
            CountPill(n.count)
            Icon(if (r.collapsed) Icons.Filled.ExpandMore else Icons.Filled.ExpandLess, null, tint = c.mutedFg)
        }
    }
}

@Composable
internal fun CountPill(n: Int) {
    val c = Nx.colors
    Text("$n", style = CalType.s12, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(end = 4.dp).clip(CircleShape).background(c.muted).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
private fun PersonHead(d: CalDerived, r: PanelRow.Person, modifier: Modifier) {
    val c = Nx.colors
    val p = d.ix.person[r.userId]
    val also = p?.homeUnitIds?.filter { it != r.unitId }?.mapNotNull { d.ix.byId[it]?.name }.orEmpty()
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically) {
        Initials(d.name(r.userId), d.color(r.unitId), 28)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(d.name(r.userId) ?: stringResource(R.string.cal_former_member), style = CalType.s14, fontWeight = FontWeight.SemiBold, color = c.foreground,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (r.me) Text(stringResource(R.string.cal_you), style = CalType.s11, fontWeight = FontWeight.Bold, color = c.onNavy,
                    modifier = Modifier.padding(start = 6.dp).clip(CircleShape).background(c.navy).padding(horizontal = 7.dp, vertical = 1.dp))
            }
            if (r.unitId == null) Text(stringResource(R.string.cal_not_in_chart_lower), style = CalType.s12, color = c.mutedFg)
            else if (also.isNotEmpty()) Text(stringResource(R.string.cal_also_in, also.joinToString(", ")), style = CalType.s12, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        CountPill(r.count)
    }
}

/** Initials on a division colour: ink picked by the fill's lightness (pastels in dark mode, audit #22); decorative for TalkBack. */
@Composable
internal fun Initials(name: String?, color: Color, size: Int) {
    val text = name?.trim()?.split(Regex("\\s+"))?.take(2)?.joinToString("") { it.take(1).uppercase() }?.ifEmpty { "?" } ?: "?"
    val ink = if (color.luminance() > 0.35f) Nx.colors.inkOnLight else Color.White
    // In dp terms, so the letters scale with the circle, not with the font setting (audit 3 #2).
    val fs = with(LocalDensity.current) { (size * 0.36).dp.toSp() }
    Box(Modifier.size(size.dp).clip(CircleShape).background(color).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        // The line box is the font size, centred and trimmed, so the letters sit in the middle at any font scale (audit #15).
        Text(text, style = UiTextStyle(fontSize = fs, lineHeight = fs, fontWeight = FontWeight.Bold, color = ink,
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both)), maxLines = 1)
    }
}

// ── task row ───────────────────────────────────────────────────────────────────────────────────

/** Ring = to do, ✓ = done, ! red = overdue ≤ 14 days, grey ring = older, small diamond = no status, lock = masked. Decorative: the row says it in words. */
@Composable
internal fun TaskGlyph(d: CalDerived, i: CalItem, size: Int = 18) {
    val c = Nx.colors
    val od = d.overdue(i)
    Box(Modifier.size(size.dp).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        when {
            i.masked -> Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size((size - 4).dp))
            i.noStatus -> Box(Modifier.size((size * 0.45).dp).rotate(45f).background(c.mutedFg))
            i.done -> Box(Modifier.size(size.dp).clip(CircleShape).background(c.success), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Check, null, tint = c.onSuccess, modifier = Modifier.size((size - 6).dp)) }
            od == CalendarCore.Overdue.RECENT -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.8.dp, c.danger, CircleShape), contentAlignment = Alignment.Center) {
                Text("!", fontSize = (size * 0.6).sp, fontWeight = FontWeight.Bold, color = c.dangerText, lineHeight = (size * 0.6).sp)
            }
            od == CalendarCore.Overdue.STALE -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.5.dp, c.mutedFg.copy(alpha = 0.5f), CircleShape))
            else -> Box(Modifier.size(size.dp).clip(CircleShape).border(1.5.dp, c.mutedFg, CircleShape))
        }
    }
}

/** The status of a row in words, for TalkBack (audit #5). */
@Composable
internal fun statusWords(d: CalDerived, i: CalItem): String = stringResource(when {
    i.masked -> R.string.cal_internal
    i.noStatus -> R.string.cal_no_status
    i.done -> R.string.cal_status_done
    d.overdue(i) == CalendarCore.Overdue.RECENT -> R.string.cal_overdue
    else -> R.string.cal_status_todo
})

/**
 * Task row: glyph, title (2 lines; done struck through; stale grey), time right, project dot + name
 * (+N project), URGENT/HIGH chip, "Overdue", "↳ from <parent>", the people at this unit, then "with
 * Name (Unit)", wrapping (audit #36). A masked row: lock + "Internal task" (inside its division's card) or
 * "Internal task · <division>" (rail, People); a tap says why it does not open (decision 1, audit #37).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskRow(d: CalDerived, i: CalItem, unitId: String?, vm: CalendarViewModel, showDay: Boolean = false, person: String? = null, inCard: Boolean = false) {
    val c = Nx.colors
    val od = d.overdue(i)
    val editable = i.canEdit && i.editProjectId != null && i.editProjectId == i.project?.id
    val status = statusWords(d, i)
    val action = stringResource(when { i.masked -> R.string.cal_why_locked; editable -> R.string.cal_open_task; else -> R.string.cal_open_read_only })
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).semantics { stateDescription = status }
        .clickable(onClickLabel = action) { vm.open(i) }.heightIn(min = 48.dp).padding(vertical = 8.dp),
        verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 1.dp)) { TaskGlyph(d, i) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            if (i.masked) {
                val section = if (inCard) null else d.sectionName(i)
                Text(section?.let { stringResource(R.string.cal_internal_in, it) } ?: stringResource(R.string.cal_internal), style = CalType.s14, color = c.mutedFg)
            } else {
                Text(i.title.orEmpty(), style = CalType.s14, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = if (i.done || od == CalendarCore.Overdue.STALE) c.mutedFg else c.foreground,
                    textDecoration = if (i.done) TextDecoration.LineThrough else null)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    i.project?.let { p ->
                        Box(Modifier.size(7.dp).clip(CircleShape).background(projectColor(p.color ?: "#64748b")))
                        Spacer(Modifier.width(5.dp))
                        Text(p.name + if (i.linkedProjectIds.isNotEmpty()) " " + pluralStringResource(R.plurals.cal_project_more, i.linkedProjectIds.size, i.linkedProjectIds.size) else "",
                            style = CalType.s12, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                    if (i.priority == "URGENT" || i.priority == "HIGH") {
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(if (i.priority == "URGENT") R.string.cal_prio_urgent else R.string.cal_prio_high).uppercase(Locale.getDefault()), style = CalType.s11,
                            fontWeight = FontWeight.Bold, color = c.dangerText, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(c.danger.copy(alpha = 0.1f)).padding(horizontal = 6.dp, vertical = 1.dp))
                    }
                }
                if (od == CalendarCore.Overdue.RECENT) Text(stringResource(R.string.cal_overdue) + if (showDay) " · ${shortDay(i.day)}" else "", style = CalType.s12, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                if (od == CalendarCore.Overdue.STALE) Text(stringResource(R.string.cal_overdue_older, d.s.windowDays), style = CalType.s12, color = c.mutedFg)
                i.parent?.let { Text("↳ " + stringResource(R.string.cal_from, it.title), style = CalType.s12, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            PeopleLine(d, i, unitId, person)
        }
        i.time?.let { Text(clock(it), style = CalType.s12, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.padding(start = 8.dp)) }
    }
}

/** "4 internal tasks · 09.00, 13.00 · Budi, Sari Wulandari": one line for a run of masked rows; a tap says why. */
@Composable
private fun MaskedGroupRow(d: CalDerived, vm: CalendarViewModel, r: PanelRow.MaskedGroup) {
    val c = Nx.colors
    val people = r.items.flatMap { i -> i.placements.firstOrNull { it.unitId == r.unitId }?.userIds.orEmpty() }.distinct().mapNotNull { d.name(it) }
    val times = r.items.mapNotNull { it.time }.distinct().map { clock(it) }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = stringResource(R.string.cal_why_locked)) { vm.open(r.items.first()) }
        .heightIn(min = 48.dp).padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 1.dp)) { TaskGlyph(d, r.items.first()) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(pluralStringResource(R.plurals.cal_internal_n, r.items.size, r.items.size), style = CalType.s14, color = c.mutedFg)
            val sub = listOfNotNull(times.takeIf { it.isNotEmpty() }?.joinToString(", "), people.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, style = CalType.s12, color = c.mutedFg)
        }
    }
}

/** The people at this unit, then "with Name (Unit)" for the ones placed elsewhere and the ones not in the chart — wrapping, never clipped. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PeopleLine(d: CalDerived, i: CalItem, unitId: String?, person: String? = null) {
    val c = Nx.colors
    // Under a person (lens "person") that person is the heading already: only the others are named.
    val here = i.placements.firstOrNull { it.unitId == unitId }?.userIds.orEmpty().filter { it != person }
    val elsewhere = i.placements.filter { it.unitId != unitId }.flatMap { p -> p.userIds.map { it to d.ix.byId[p.unitId]?.name } }.filter { it.first !in here && it.first != person }
    val outside = i.unplacedIds.filter { it != person }.map { it to null as String? }
    if (here.isEmpty() && elsewhere.isEmpty() && outside.isEmpty()) return
    FlowRow(verticalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        here.forEach { u ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                Initials(d.name(u), d.color(unitId), 18); Spacer(Modifier.width(4.dp))
                Text(d.name(u) ?: stringResource(R.string.cal_former_member), style = CalType.s12, color = c.foreground)
            }
        }
        val others = (elsewhere + outside).distinctBy { it.first }
        if (others.isNotEmpty()) {
            val former = stringResource(R.string.cal_former_member)
            Text(stringResource(R.string.cal_with) + " " + others.joinToString(", ") { (u, unit) -> (d.name(u) ?: former) + (unit?.let { " ($it)" } ?: "") },
                style = CalType.s12, color = c.mutedFg)
        }
    }
}

/** The Calendar's layout for a given state, without loading (debug screenshots from the golden files). */
@Composable
internal fun CalendarPreviewLayout(s: CalState, vm: CalendarViewModel, filters: Boolean = false) {
    CalendarContent(s, vm, onBack = {}, onOpenMyMission = {}, filtersInitially = filters)
}
