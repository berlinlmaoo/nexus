package id.znetworks.nexus.feature.calendar

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.util.Locale

/**
 * Filters, full screen (no bottom sheet): who (Everyone / Mine / My division — off when not in the
 * chart), divisions (tree with checkboxes; a group selects its cards), people and projects (searchable,
 * from the month on screen), priority, hide done, only overdue, Reset. Applied as they change and
 * remembered per device (CalendarViewModel).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FiltersScreen(d: CalDerived, vm: CalendarViewModel, onClose: () -> Unit) {
    val c = Nx.colors
    val f = d.s.filters
    fun set(x: CalendarCore.Filters) = vm.setFilters(x)
    var qPeople by rememberSaveable { mutableStateOf("") }
    var qProjects by rememberSaveable { mutableStateOf("") }
    BackHandler(onBack = onClose)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.cal_close)) }
                Text(stringResource(R.string.cal_filters), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
                TextButton(onClick = { set(CalendarCore.NO_FILTERS) }, enabled = d.filterCount > 0) { Text(stringResource(R.string.cal_reset)) }
            }
            HorizontalDivider(color = c.border)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Section(stringResource(R.string.cal_show)) {
                    val inChart = d.me?.homeUnitIds.orEmpty().isNotEmpty()
                    Segmented(listOf(stringResource(R.string.cal_everyone), stringResource(R.string.cal_mine), stringResource(R.string.cal_my_division)), f.scope.ordinal) {
                        val scope = CalendarCore.Scope.entries[it]
                        if (scope != CalendarCore.Scope.DIVISION || inChart) set(f.copy(scope = scope))
                    }
                    if (!inChart) Text(stringResource(R.string.cal_not_in_chart_scope), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(top = 6.dp))
                }
                Section(stringResource(R.string.cal_divisions)) {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp))) {
                        d.ix.units.forEach { u ->
                            val on = u.id in f.units
                            Row(Modifier.fillMaxWidth().clickable { set(f.copy(units = if (on) f.units - u.id else f.units + u.id)) }.padding(start = (8 + 16 * u.depth).dp, end = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(on, null)
                                Box(Modifier.size(8.dp).clip(CircleShape).background(d.color(u.id))); Spacer(Modifier.width(8.dp))
                                Text(if (u.isGroup) u.name.uppercase(Locale.getDefault()) else u.name, fontSize = if (u.isGroup) 11.sp else 14.sp,
                                    fontWeight = if (u.isGroup) FontWeight.Bold else FontWeight.Normal, color = if (u.isGroup) c.mutedFg else c.foreground)
                            }
                        }
                    }
                }
                Section(stringResource(R.string.cal_people)) {
                    val ids = d.all.flatMap { it.assigneeIds }.distinct()
                    val people = ids.map { it to (d.name(it) ?: "") }.filter { qPeople.isBlank() || it.second.contains(qPeople.trim(), true) }
                        .sortedWith { a, b -> CalendarCore.localeCompare(a.second, b.second) }
                    OutlinedTextField(qPeople, { qPeople = it }, singleLine = true, placeholder = { Text(stringResource(R.string.cal_search_people)) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
                    if (ids.isEmpty()) Text(stringResource(R.string.cal_nobody_month), fontSize = 12.sp, color = c.mutedFg)
                    people.forEach { (id, name) ->
                        val on = id in f.people
                        Row(Modifier.fillMaxWidth().clickable { set(f.copy(people = if (on) f.people - id else f.people + id)) }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(on, null); Initials(name, Color(0xFF1E3A5F), 22); Spacer(Modifier.width(8.dp))
                            Text(name.ifEmpty { stringResource(R.string.cal_former_member) }, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                Section(stringResource(R.string.cal_projects)) {
                    val projects = d.all.mapNotNull { it.project }.distinctBy { it.id }
                    val shown = projects.filter { qProjects.isBlank() || it.name.contains(qProjects.trim(), true) }.sortedWith { a, b -> CalendarCore.localeCompare(a.name, b.name) }
                    OutlinedTextField(qProjects, { qProjects = it }, singleLine = true, placeholder = { Text(stringResource(R.string.cal_search_projects)) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
                    if (projects.isEmpty()) Text(stringResource(R.string.cal_no_project_month), fontSize = 12.sp, color = c.mutedFg)
                    shown.forEach { p ->
                        val on = p.id in f.projects
                        Row(Modifier.fillMaxWidth().clickable { set(f.copy(projects = if (on) f.projects - p.id else f.projects + p.id)) }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(on, null); Box(Modifier.size(8.dp).clip(CircleShape).background(CalDerived.hex(p.color ?: "#64748b"))); Spacer(Modifier.width(8.dp))
                            Text(p.name, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                Section(stringResource(R.string.cal_priority)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("URGENT" to R.string.cal_prio_urgent, "HIGH" to R.string.cal_prio_high, "MEDIUM" to R.string.cal_prio_medium, "LOW" to R.string.cal_prio_low, "NONE" to R.string.cal_prio_none)
                            .forEach { (k, label) ->
                                val on = k in f.priorities
                                Text(stringResource(label), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else c.foreground,
                                    modifier = Modifier.clip(CircleShape).background(if (on) Color(0xFF1E3A5F) else c.card).border(1.dp, if (on) Color.Transparent else c.border, CircleShape)
                                        .clickable { set(f.copy(priorities = if (on) f.priorities - k else f.priorities + k)) }.padding(horizontal = 12.dp, vertical = 6.dp))
                            }
                    }
                }
                Toggle(stringResource(R.string.cal_hide_done), f.hideDone) { set(f.copy(hideDone = it)) }
                Toggle(stringResource(R.string.cal_only_overdue), f.overdueOnly) { set(f.copy(overdueOnly = it)) }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = Nx.colors.mutedFg)
        content()
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!on) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = Nx.colors.foreground, modifier = Modifier.weight(1f))
        Switch(on, onChange)
    }
}
