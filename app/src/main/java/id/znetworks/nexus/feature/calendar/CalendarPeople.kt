package id.znetworks.nexus.feature.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.calendar.CalendarCore.WeekRow
import id.znetworks.nexus.ui.theme.Nx
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * People view (the week of the selected day, CalendarCore.weekRows, remembered — audit #18). Phone: each
 * division is a sticky header, people are one flat card each (no card-in-card stairs, audit #35), a task
 * line opens the task (audit #34), "+N more" opens the rest in place, the person header goes to Month on
 * their first day. Tablet: the week table, rows ≥ 48 dp, every day cell named (audit #7).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun PeopleView(d: CalDerived, vm: CalendarViewModel, tablet: Boolean, onFilters: () -> Unit) {
    val c = Nx.colors
    val s = d.s
    val monday = CalendarCore.mondayOf(s.day)
    val rows = remember(d.data, monday) { visibleRows(CalendarCore.weekRows(d.shown, d.ix, d.focus, monday, s.today, s.nowMs, s.windowDays)) }
    fun goDay(day: String) { vm.setLens(CalLens.PERSON); vm.setView(CalView.MONTH); vm.selectDay(day) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item(key = "controls") { Controls(d, vm) }
        item(key = "legend") { Legend(d, vm) }
        // Not loaded (or failed) for this week: a bar or the reason, never "nobody this week".
        if (!d.ready) item(key = "status") { RangeStatus(d, vm) }
        else if (rows.isEmpty()) item(key = "empty") {
            // Why it is empty, and the way out (audit #44).
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.cal_nobody_week), fontWeight = FontWeight.SemiBold, color = c.foreground)
                Text(stringResource(if (d.filterCount > 0) R.string.cal_filters_hiding else R.string.cal_pick_week), fontSize = 12.sp, color = c.mutedFg)
                if (d.filterCount > 0) TextButton(onClick = { vm.resetFilters() }) { Text(stringResource(R.string.cal_reset_filters)) }
                else if (CalendarCore.mondayOf(s.today) != monday) TextButton(onClick = { vm.today() }) { Text(stringResource(R.string.cal_go_this_week)) }
            }
        }
        if (tablet && rows.isNotEmpty()) item(key = "weekhead") { WeekHeader(monday, s.today) }
        rows.forEach { r ->
            val key = when (r) { is WeekRow.Unit -> "u:${r.unit.id}"; is WeekRow.Unplaced -> "unplaced"; is WeekRow.Person -> "p:${r.unitId}:${r.userId}"; is WeekRow.Loose -> "l:${r.unitId}" }
            when (r) {
                is WeekRow.Unit, is WeekRow.Unplaced -> stickyHeader(key = key) { UnitHeader(d, r, pathOf(d, r)) }
                else -> item(key = key) { if (tablet) TableRow(d, vm, r, monday, ::goDay) else PhoneRow(d, vm, r, key, ::goDay) }
            }
        }
    }
}

/**
 * Only unit headers that hold people (or tasks without a person) directly: a chain of empty headers
 * ("PT. THE Z NETWORKS", "FRAMEWORK AGENCY", "PROJECT MANAGEMENT") becomes one header with the path
 * (audit 2 #12).
 */
internal fun visibleRows(rows: List<WeekRow>): List<WeekRow> = rows.filterIndexed { i, r ->
    r !is WeekRow.Unit || rows.getOrNull(i + 1).let { it is WeekRow.Person || it is WeekRow.Loose }
}

/** "Framework Agency › Project Management": the unit's line under the focus (groups left out). */
private fun pathOf(d: CalDerived, r: WeekRow): String? {
    if (r !is WeekRow.Unit) return null
    val up = d.ix.ancestors(r.unit.id).reversed()
    val below = up.dropWhile { it != d.focus }.drop(1).mapNotNull { d.ix.byId[it] }.filter { !it.isGroup }.map { it.name }
    return (below + r.unit.name).joinToString(" › ")
}

/** A division (or "Not in the chart yet") as a sticky section header: colour bar, path, count. */
@Composable
private fun UnitHeader(d: CalDerived, r: WeekRow, path: String?) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().background(c.background).padding(horizontal = 16.dp, vertical = 10.dp).semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically) {
        when (r) {
            is WeekRow.Unit -> {
                if (!r.unit.isGroup) { Box(Modifier.width(3.dp).height(16.dp).background(d.color(r.unit.id))); Spacer(Modifier.width(8.dp)) }
                Text((path ?: r.unit.name).uppercase(Locale.getDefault()), style = MicroLabel,
                    color = if (r.unit.isGroup) c.mutedFg else c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                CountPill(r.count)
            }
            is WeekRow.Unplaced -> Text(stringResource(R.string.cal_not_in_chart_n, r.count).uppercase(Locale.getDefault()), style = MicroLabel, color = c.mutedFg, modifier = Modifier.weight(1f))
            else -> {}
        }
    }
}

@Composable
private fun PhoneRow(d: CalDerived, vm: CalendarViewModel, r: WeekRow, key: String, goDay: (String) -> Unit) {
    val c = Nx.colors
    val (days, userId, unitId) = when (r) { is WeekRow.Person -> Triple(r.days, r.userId, r.unitId); is WeekRow.Loose -> Triple(r.days, null, r.unitId); else -> return }
    val flat = days.flatten()
    var open by rememberSaveable(key) { mutableStateOf(false) }
    val showLabel = stringResource(R.string.cal_show_in_month)
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(c.card)
        .border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 4.dp)) {
        // The header goes to Month on this person's first day with a task, lens "person".
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = flat.isNotEmpty(), onClickLabel = showLabel) { flat.firstOrNull()?.let { goDay(it.day) } },
            verticalAlignment = Alignment.CenterVertically) {
            if (userId != null) { Initials(d.name(userId), d.color(unitId), 26); Spacer(Modifier.width(8.dp)) }
            Text(if (userId != null) d.name(userId) ?: stringResource(R.string.cal_former_member) else stringResource(R.string.cal_without_person),
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (userId != null && userId == d.me?.userId) Text(stringResource(R.string.cal_you), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.onNavy,
                modifier = Modifier.padding(end = 6.dp).clip(RoundedCornerShape(50)).background(c.navy).padding(horizontal = 7.dp, vertical = 1.dp))
            // The week at a glance: a square per day, darker with more tasks (decorative; the count says it).
            Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                days.forEach { list -> Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(if (list.isEmpty()) c.muted else d.color(unitId).copy(alpha = (0.35f + 0.2f * list.size).coerceAtMost(1f)))) }
            }
            Spacer(Modifier.width(6.dp)); CountPill(flat.size)
        }
        (if (open) flat else flat.take(3)).forEach { i -> WeekTaskLine(d, vm, i) }
        if (flat.size > 3) TextButton(onClick = { open = !open }) {
            Text(if (open) stringResource(R.string.cal_show_less) else pluralStringResource(R.plurals.cal_more_n, flat.size - 3, flat.size - 3), fontWeight = FontWeight.SemiBold)
        }
    }
}

/** "Thu 8 · title": opens the task like the Month rows do (masked: says why). */
@Composable
private fun WeekTaskLine(d: CalDerived, vm: CalendarViewModel, i: CalItem) {
    val c = Nx.colors
    val editable = i.canEdit && i.editProjectId != null && i.editProjectId == i.project?.id
    val action = stringResource(when { i.masked -> R.string.cal_why_locked; editable -> R.string.cal_open_task; else -> R.string.cal_open_read_only })
    val status = statusWords(d, i)
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { stateDescription = status }.clickable(onClickLabel = action) { vm.open(i) },
        verticalAlignment = Alignment.CenterVertically) {
        TaskGlyph(d, i, 14); Spacer(Modifier.width(6.dp))
        Text(shortDay(i.day) + " · ", fontSize = 12.sp, color = c.mutedFg)
        Text(if (i.masked) d.sectionName(i)?.let { stringResource(R.string.cal_internal_in, it) } ?: stringResource(R.string.cal_internal) else i.title.orEmpty(),
            fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            color = if (i.done) c.mutedFg else c.foreground, textDecoration = if (i.done) TextDecoration.LineThrough else null)
    }
}

@Composable
private fun WeekHeader(monday: String, today: String) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clearAndSetSemantics {}) {
        Text(stringResource(R.string.cal_person).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.width(180.dp))
        (0 until 7).forEach { k ->
            val day = CalendarCore.addDays(monday, k)
            Text(DateTimeFormatter.ofPattern("EEE d", Locale.getDefault()).format(LocalDate.parse(day)).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                color = if (day == today) c.violetText else c.mutedFg, modifier = Modifier.weight(1f))
        }
    }
    HorizontalDivider(color = c.border)
}

/** Tablet week table row: ≥ 48 dp, cells fill the row height and say their day and count; empty days are not buttons. */
@Composable
private fun TableRow(d: CalDerived, vm: CalendarViewModel, r: WeekRow, monday: String, goDay: (String) -> Unit) {
    val c = Nx.colors
    val (days, userId, unitId) = when (r) { is WeekRow.Person -> Triple(r.days, r.userId, r.unitId); is WeekRow.Loose -> Triple(r.days, null, r.unitId); else -> return }
    val showLabel = stringResource(R.string.cal_show_in_month)
    val noTasks = stringResource(R.string.cal_no_tasks)
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).heightIn(min = 48.dp).padding(horizontal = 12.dp)) {
        Row(Modifier.width(180.dp).fillMaxHeight().padding(top = 8.dp), verticalAlignment = Alignment.Top) {
            if (userId != null) { Initials(d.name(userId), d.color(unitId), 22); Spacer(Modifier.width(6.dp)) }
            Text(if (userId != null) d.name(userId) ?: stringResource(R.string.cal_former_member) else stringResource(R.string.cal_without_person),
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (userId == null) c.mutedFg else c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        days.forEachIndexed { k, list ->
            val day = CalendarCore.addDays(monday, k)
            val described = longDay(day) + ", " + if (list.isEmpty()) noTasks else pluralStringResource(R.plurals.cal_tasks_n, list.size, list.size)
            Column(Modifier.weight(1f).fillMaxHeight().semantics { contentDescription = described }
                .then(if (list.isNotEmpty()) Modifier.clickable(onClickLabel = showLabel) { goDay(day) } else Modifier).padding(4.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)) {
                list.take(2).forEach { i ->
                    // A 48 dp line with its status and action for TalkBack, as on the phone (audit 2 #4).
                    val editable = i.canEdit && i.editProjectId != null && i.editProjectId == i.project?.id
                    val action = stringResource(when { i.masked -> R.string.cal_why_locked; editable -> R.string.cal_open_task; else -> R.string.cal_open_read_only })
                    val status = statusWords(d, i)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .semantics { stateDescription = status }.clickable(onClickLabel = action) { vm.open(i) }) {
                        TaskGlyph(d, i, 12); Spacer(Modifier.width(4.dp))
                        Text(if (i.masked) stringResource(R.string.cal_internal) else i.title.orEmpty(), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = if (i.done) c.mutedFg else c.foreground, textDecoration = if (i.done) TextDecoration.LineThrough else null)
                    }
                }
                if (list.size > 2) Text(pluralStringResource(R.plurals.cal_more_n, list.size - 2, list.size - 2), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
            }
        }
    }
    HorizontalDivider(color = c.border.copy(alpha = 0.6f))
}
