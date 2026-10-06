package id.znetworks.nexus.feature.calendar

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
 * People view (the week of the selected day, CalendarCore.weekRows): phone = per division › person with
 * up to 3 tasks ("Thu 8 · title") and "+N more"; tablet = the week table (name + 7 day columns, 2 chips
 * per cell + "+N"). Tapping a day goes to Month on that day with the person lens.
 */
@Composable
internal fun PeopleView(d: CalDerived, vm: CalendarViewModel, tablet: Boolean, onFilters: () -> Unit) {
    val c = Nx.colors
    val s = d.s
    val monday = CalendarCore.mondayOf(s.day)
    val rows = CalendarCore.weekRows(d.shown, d.ix, d.focus, monday, s.today, s.nowMs, s.windowDays)
    fun goDay(day: String) { vm.setLens(CalLens.PERSON); vm.setView(CalView.MONTH); vm.selectDay(day) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Controls(d, vm, onFilters) }
        item { Legend(d, vm) }
        if (rows.isEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.cal_nobody_week), fontWeight = FontWeight.SemiBold, color = c.foreground)
                Text(stringResource(R.string.cal_pick_week), fontSize = 12.sp, color = c.mutedFg)
            }
        }
        if (tablet && rows.isNotEmpty()) item { WeekHeader(monday, s.today) }
        items(rows, key = { r -> when (r) { is WeekRow.Unit -> "u:${r.unit.id}"; is WeekRow.Unplaced -> "unplaced"; is WeekRow.Person -> "p:${r.unitId}:${r.userId}"; is WeekRow.Loose -> "l:${r.unitId}" } }) { r ->
            if (tablet) TableRow(d, vm, r, monday, ::goDay) else PhoneRow(d, vm, r, monday, ::goDay)
        }
    }
}

@Composable
private fun UnitHeader(d: CalDerived, r: WeekRow.Unit) {
    val c = Nx.colors
    if (r.unit.isGroup) {
        Text("${r.unit.name.uppercase(Locale.getDefault())} · ${r.count}", fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp, color = c.mutedFg,
            modifier = Modifier.padding(start = (16 + 12 * r.depth).dp, top = 10.dp, bottom = 4.dp))
        return
    }
    Row(Modifier.fillMaxWidth().padding(start = (12 + 12 * r.depth).dp, end = 12.dp, top = 8.dp).clip(RoundedCornerShape(12.dp)).background(c.card)
        .border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).height(16.dp).background(d.color(r.unit.id)))
        Spacer(Modifier.width(8.dp))
        Text(r.unit.name.uppercase(Locale.getDefault()), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        CountPill(r.count)
    }
}

@Composable
private fun PhoneRow(d: CalDerived, vm: CalendarViewModel, r: WeekRow, monday: String, goDay: (String) -> Unit) {
    val c = Nx.colors
    when (r) {
        is WeekRow.Unit -> UnitHeader(d, r)
        is WeekRow.Unplaced -> Text(stringResource(R.string.cal_not_in_chart_n, r.count).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp, color = c.mutedFg, modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp))
        is WeekRow.Person, is WeekRow.Loose -> {
            val (days, userId, unitId) = when (r) { is WeekRow.Person -> Triple(r.days, r.userId, r.unitId); is WeekRow.Loose -> Triple(r.days, null, r.unitId); else -> error("") }
            val flat = days.flatten()
            Column(Modifier.fillMaxWidth().padding(start = (12 + 12 * r.depth).dp, end = 12.dp, top = 6.dp).clip(RoundedCornerShape(12.dp)).background(c.card)
                .border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (userId != null) { Initials(d.name(userId), d.color(unitId), 26); Spacer(Modifier.width(8.dp)) }
                    Text(if (userId != null) d.name(userId) ?: stringResource(R.string.cal_former_member) else stringResource(R.string.cal_without_person),
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    // The week at a glance: a square per day, darker with more tasks.
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        days.forEach { list -> Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(if (list.isEmpty()) c.muted else d.color(unitId).copy(alpha = (0.35f + 0.2f * list.size).coerceAtMost(1f)))) }
                    }
                    Spacer(Modifier.width(6.dp)); CountPill(flat.size)
                }
                flat.take(3).forEach { i ->
                    Row(Modifier.fillMaxWidth().clickable { goDay(i.day) }.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        TaskGlyph(d, i, 14); Spacer(Modifier.width(6.dp))
                        Text(shortDay(i.day) + " · ", fontSize = 12.sp, color = c.mutedFg)
                        Text(if (i.masked) stringResource(R.string.cal_internal) else i.title.orEmpty(), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            color = if (i.done) c.mutedFg else c.foreground, textDecoration = if (i.done) TextDecoration.LineThrough else null)
                    }
                }
                if (flat.size > 3) Text(pluralStringResource(R.plurals.cal_more_n, flat.size - 3, flat.size - 3), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    color = c.violetText, modifier = Modifier.padding(top = 6.dp).clickable { goDay(flat[3].day) })
            }
        }
    }
}

@Composable
private fun WeekHeader(monday: String, today: String) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Text(stringResource(R.string.cal_person).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.width(180.dp))
        (0 until 7).forEach { k ->
            val day = CalendarCore.addDays(monday, k)
            Text(DateTimeFormatter.ofPattern("EEE d", Locale.getDefault()).format(LocalDate.parse(day)).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                color = if (day == today) c.violetText else c.mutedFg, modifier = Modifier.weight(1f))
        }
    }
    HorizontalDivider(color = c.border)
}

@Composable
private fun TableRow(d: CalDerived, vm: CalendarViewModel, r: WeekRow, monday: String, goDay: (String) -> Unit) {
    val c = Nx.colors
    when (r) {
        is WeekRow.Unit -> UnitHeader(d, r)
        is WeekRow.Unplaced -> Text(stringResource(R.string.cal_not_in_chart_n, r.count).uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold,
            color = c.mutedFg, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
        is WeekRow.Person, is WeekRow.Loose -> {
            val (days, userId, unitId) = when (r) { is WeekRow.Person -> Triple(r.days, r.userId, r.unitId); is WeekRow.Loose -> Triple(r.days, null, r.unitId); else -> error("") }
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 12.dp)) {
                Row(Modifier.width(180.dp).padding(start = (12 * r.depth).dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (userId != null) { Initials(d.name(userId), d.color(unitId), 22); Spacer(Modifier.width(6.dp)) }
                    Text(if (userId != null) d.name(userId) ?: stringResource(R.string.cal_former_member) else stringResource(R.string.cal_without_person),
                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (userId == null) c.mutedFg else c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                days.forEachIndexed { k, list ->
                    val day = CalendarCore.addDays(monday, k)
                    Column(Modifier.weight(1f).clickable { goDay(day) }.padding(4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        list.take(2).forEach { i ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TaskGlyph(d, i, 12); Spacer(Modifier.width(4.dp))
                                Text(if (i.masked) stringResource(R.string.cal_internal) else i.title.orEmpty(), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    color = if (i.done) c.mutedFg else c.foreground, textDecoration = if (i.done) TextDecoration.LineThrough else null)
                            }
                        }
                        if (list.size > 2) Text(pluralStringResource(R.plurals.cal_more_n, list.size - 2, list.size - 2), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                    }
                }
            }
            HorizontalDivider(color = c.border.copy(alpha = 0.6f))
        }
    }
}
