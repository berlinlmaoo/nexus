package id.znetworks.nexus.feature.reports

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.dueDate
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PageTab
import id.znetworks.nexus.ui.components.PageTabs
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
private fun reportsApi(): ReportsApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { ReportsApi(c.api) }
}

/** The 28→27 period key [offset] periods from today's (the server decides "current" when null). */
private fun periodKey(offset: Int): String? = if (offset == 0) null else YearMonth.parse(OfficeTime.periodKey(OfficeTime.today())).plusMonths(offset.toLong()).toString()

@Composable
private fun PeriodBar(offset: Int, period: ReportPeriod?, onChange: (Int) -> Unit) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 8.dp)) {
        IconButton(onClick = { onChange(offset - 1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
        val label = period?.let { p ->
            val f = AppDateFormats.ofPattern("d MMM", Locale.getDefault())
            listOfNotNull(dueDate(p.from)?.let(f::format), dueDate(p.to)?.let(f::format)).joinToString(" – ")
        }.orEmpty()
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(if (offset == 0) R.string.rp_this_period else R.string.rp_period), fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground)
            Text(label, fontSize = 11.sp, color = c.mutedFg)
        }
        IconButton(onClick = { onChange(offset + 1) }, enabled = offset < 0) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) }
    }
}

@Composable
fun ReportsScreen(onBack: () -> Unit, onOpenPerson: (String, Int) -> Unit, onOpenTask: (String) -> Unit) {
    val api = reportsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var roster by remember { mutableStateOf<ReportRoster?>(null) }
    var selfOnly by remember { mutableStateOf(false) }
    var rosterError by remember { mutableStateOf<String?>(null) }
    var rosterSavedAt by remember { mutableStateOf<Long?>(null) }
    var q by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(offset) {
        try { val got = api.roster(periodKey(offset)); roster = got.value; rosterSavedAt = got.savedAtMillis; rosterError = null }
        catch (e: ApiError) {
            // Staff: not a fault, there is simply no team view.
            if (e is ApiError.Http && e.code == "REPORT_SELF_ONLY") selfOnly = true else rosterError = e.describe(res)
        }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        val showTeam = !selfOnly && roster?.scope != "SELF"
        // Dev web reports page: the subtitle follows the tab (me / direct reports / everyone).
        val subtitle = stringResource(when {
            tab == 0 || !showTeam -> R.string.sub_reports_me
            roster?.scope == "ALL" -> R.string.sub_reports_all
            else -> R.string.sub_reports_team
        })
        PageHeader(stringResource(R.string.rp_title), subtitle = subtitle, onBack = onBack,
            tabs = if (showTeam) { {
                PageTabs(listOf(PageTab(0, stringResource(R.string.rp_me)), PageTab(1, stringResource(R.string.rp_team))), tab, { tab = it })
            } } else null)
        PeriodBar(offset, roster?.period, { offset = it })
        rosterSavedAt?.let { Text(stringResource(R.string.saved_copy_from, id.znetworks.nexus.feature.attendance.LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.warning, modifier = Modifier.padding(horizontal = 16.dp)) }
        if (tab == 0 || !showTeam) PersonReportBody("me", periodKey(offset), onOpenTask)
        else {
            val r = roster
            OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) }, placeholder = { Text(stringResource(R.string.rp_search_crew)) },
                shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
            when {
                r == null && rosterError == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                r == null -> TabEmpty(Icons.Filled.BarChart, rosterError!!)
                r.rows.isEmpty() -> TabEmpty(Icons.Filled.BarChart, stringResource(if (r.scope == "DIRECT_REPORTS") R.string.rp_no_reports else R.string.rp_no_one))
                else -> {
                    val rows = ReportLogic.filter(r.rows, q)
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        item { Text(stringResource(if (r.scope == "DIRECT_REPORTS") R.string.rp_your_reports else R.string.rp_everyone) + " · " + stringResource(R.string.rp_people_n, rows.size), fontSize = 12.sp, color = c.mutedFg) }
                        if (rows.isEmpty()) item { Text(stringResource(R.string.rp_no_match, q), fontSize = 13.sp, color = c.mutedFg) }
                        items(rows, key = { it.userId }) { row -> RosterCard(row) { onOpenPerson(row.userId, offset) } }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RosterCard(r: RosterRow, onClick: () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(r.name, r.avatar, 32.dp, userId = r.userId); Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(r.name ?: r.email ?: "—", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f, fill = false))
                    id.znetworks.nexus.ui.components.LeftTag(r.leftAt)
                }
                Text(r.teams.mapNotNull { it.name }.joinToString(", "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
            }
            Text("${r.headline.xpScore} XP", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.violetText)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Small(stringResource(R.string.rp_done), "${r.headline.completed}")
            Small(stringResource(R.string.rp_on_time), r.headline.onTime.pct?.let { "$it%" } ?: "—")
            Small(stringResource(R.string.rp_attendance_rate), r.headline.attendanceRate.pct?.let { "$it%" } ?: "—")
            Small(stringResource(R.string.rp_late), "${r.headline.late}")
        }
        if (r.flagCount > 0) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (r.flags.overdue3) Pill(stringResource(R.string.rp_flag_overdue), c.danger)
            if (r.flags.late3) Pill(stringResource(R.string.rp_flag_late), c.warning)
            if (r.flags.lowReflections) Pill(stringResource(R.string.rp_flag_reflections), c.mutedFg)
        }
    }
}

@Composable
private fun Small(label: String, value: String) = Column {
    Text(value, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Nx.colors.foreground)
    Text(label, fontSize = 10.sp, color = Nx.colors.mutedFg)
}

/** One person's report (Me, or someone in my team). */
@Composable
fun PersonReportScreen(userId: String, periodOffset: Int, onBack: () -> Unit, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    var offset by rememberSaveable { mutableIntStateOf(periodOffset) }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.rp_report), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        PeriodBar(offset, null, { offset = it })
        PersonReportBody(userId, periodKey(offset), onOpenTask)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonReportBody(userId: String, period: String?, onOpenTask: (String) -> Unit) {
    val api = reportsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var r by remember(userId, period) { mutableStateOf<PersonReport?>(null) }
    var error by remember(userId, period) { mutableStateOf<String?>(null) }
    var savedAt by remember(userId, period) { mutableStateOf<Long?>(null) }
    LaunchedEffect(userId, period) {
        try { val got = api.person(userId, period); r = got.value; savedAt = got.savedAtMillis } catch (e: ApiError) {
            error = if (e is ApiError.Http && e.code == "REPORT_OUT_OF_SCOPE") res.getString(R.string.rp_out_of_scope) else e.describe(res)
        }
    }
    val rep = r
    when {
        rep == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        rep == null -> TabEmpty(Icons.Filled.BarChart, error!!)
        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            savedAt?.let { Text(stringResource(R.string.saved_copy_from, id.znetworks.nexus.feature.attendance.LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.warning) }
            if (!rep.person.isSelf) Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(rep.person.name, rep.person.avatar, 40.dp, userId = rep.person.id); Spacer(Modifier.width(10.dp))
                Text(rep.person.name ?: "—", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
                id.znetworks.nexus.ui.components.LeftTag(rep.person.leftAt, Modifier.padding(start = 8.dp))
            }
            val h = rep.headline; val p = rep.previous
            Text(stringResource(R.string.rp_arrows_compare), fontSize = 11.sp, color = c.mutedFg)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 3) {
                Stat(stringResource(R.string.rp_done), "${h.completed}", ReportLogic.delta(h.completed, p?.completed), goodUp = true, Modifier.weight(1f))
                Stat(stringResource(R.string.rp_on_time), h.onTime.pct?.let { "$it%" } ?: "—", ReportLogic.delta(h.onTime.pct ?: 0, p?.onTime?.pct), true, Modifier.weight(1f))
                Stat(stringResource(R.string.rp_overdue), "${h.overdue}", ReportLogic.delta(h.overdue, p?.overdue), false, Modifier.weight(1f))
                Stat(stringResource(R.string.rp_attendance_rate), h.attendanceRate.pct?.let { "$it%" } ?: "—", ReportLogic.delta(h.attendanceRate.pct ?: 0, p?.attendanceRate?.pct), true, Modifier.weight(1f))
                Stat(stringResource(R.string.rp_late), "${h.late}", ReportLogic.delta(h.late, p?.late), false, Modifier.weight(1f))
                Stat("XP", "${h.xpScore}", ReportLogic.delta(h.xpScore, p?.xpScore), true, Modifier.weight(1f))
            }
            Section(stringResource(R.string.rp_completed_per_week)) {
                val weeks = rep.work.weekly
                if (weeks.all { it.completed == 0 }) Text(stringResource(R.string.rp_nothing_completed), fontSize = 12.sp, color = c.mutedFg)
                else {
                    val max = weeks.maxOf { it.completed }.coerceAtLeast(1)
                    Row(Modifier.fillMaxWidth().height(90.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
                        weeks.forEach { w ->
                            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Bottom, horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("${w.completed}", fontSize = 10.sp, color = c.mutedFg)
                                Box(Modifier.fillMaxWidth().height((70f * w.completed / max).dp.coerceAtLeast(2.dp)).background(c.violet, RoundedCornerShape(4.dp)))
                            }
                        }
                    }
                }
            }
            Section(stringResource(R.string.rp_overdue_now) + " · ${rep.work.overdueNow}") {
                if (rep.work.overdueList.isEmpty()) Text(stringResource(R.string.rp_nothing_overdue), fontSize = 12.sp, color = c.mutedFg)
                rep.work.overdueList.forEach { t ->
                    Row(Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(vertical = 4.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(t.title ?: stringResource(R.string.rp_untitled_task), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(t.projectName.orEmpty(), fontSize = 11.sp, color = c.mutedFg)
                        }
                        Text(stringResource(R.string.rp_days_late, t.daysOverdue ?: 0), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.danger)
                    }
                }
            }
            if (rep.work.perProject.isNotEmpty()) Section(stringResource(R.string.rp_by_project)) {
                rep.work.perProject.forEach { pp ->
                    Row {
                        Text(pp.projectName ?: stringResource(R.string.rp_untitled_project), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        Text(stringResource(R.string.rp_done_open, pp.completed, pp.open) + if (pp.overdue > 0) " · " + stringResource(R.string.rp_overdue_n, pp.overdue) else "",
                            fontSize = 12.sp, color = if (pp.overdue > 0) c.danger else c.mutedFg)
                    }
                }
            }
            Section(stringResource(R.string.rp_attendance)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Small(stringResource(R.string.rp_present), "${h.present}"); Small(stringResource(R.string.rp_late), "${h.late}")
                    Small(stringResource(R.string.rp_late_minutes), "${h.lateMinutes}"); Small(stringResource(R.string.rp_left_early), "${h.earlyLeave}")
                    Small(stringResource(R.string.rp_absent), "${h.absent}"); Small(stringResource(R.string.rp_leave), "${h.leave}")
                    Small(stringResource(R.string.rp_sick), "${h.sick}"); Small(stringResource(R.string.rp_permit), "${h.permit}")
                    Small(stringResource(R.string.rp_day_off), "${h.dayOff}"); Small(stringResource(R.string.rp_avg_worked), ReportLogic.hours(h.avgWorkedMinutes) ?: "—")
                    Small(stringResource(R.string.rp_reflections), h.reflectionRate.pct?.let { "$it%" } ?: "—")
                }
                Text(stringResource(R.string.rp_period_note), fontSize = 11.sp, color = c.mutedFg)
            }
            rep.xp?.let { xp ->
                Section(stringResource(R.string.rp_xp_period)) {
                    Text(listOfNotNull("${xp.periodScore} XP", xp.level?.let { if (it.isMax) stringResource(R.string.rp_max_level) else stringResource(R.string.home_level_n, it.level) + (it.name?.let { n -> " · $n" } ?: "") },
                        xp.streak?.takeIf { it.current > 0 }?.let { stringResource(R.string.rp_streak, it.current) }).joinToString(" · "), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    if (xp.penalties.isEmpty()) Text(stringResource(R.string.rp_no_penalties), fontSize = 12.sp, color = c.mutedFg)
                    xp.penalties.forEach { pen ->
                        Row { Text(penaltyLabel(pen.kind) + " × ${pen.count}", fontSize = 12.sp, color = c.foreground, modifier = Modifier.weight(1f)); Text("${pen.xp} XP", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.danger) }
                    }
                }
            }
            Spacer(Modifier.size(16.dp))
        }
    }
}

@Composable
/** Server XpPenaltyKind (lib/gamification.ts): late | nocheckout | alpha | peer | penalty | admin | other. */
private fun penaltyLabel(kind: String) = stringResource(when (kind) {
    "late" -> R.string.rp_pen_late
    "nocheckout" -> R.string.rp_pen_no_checkout
    "alpha" -> R.string.rp_pen_absent
    "peer" -> R.string.rp_pen_peer
    "penalty" -> R.string.rp_pen_penalty
    "admin" -> R.string.rp_pen_admin
    else -> R.string.rp_pen_other
})

@Composable
private fun Stat(label: String, value: String, delta: Int?, goodUp: Boolean, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(10.dp)) {
        Text(value, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        Text(label, fontSize = 10.sp, color = c.mutedFg, maxLines = 1)
        delta?.takeIf { it != 0 }?.let { d ->
            val good = (d > 0) == goodUp
            Text((if (d > 0) "▲ " else "▼ ") + kotlin.math.abs(d), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = if (good) c.success else c.danger)
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        content()
    }
}

