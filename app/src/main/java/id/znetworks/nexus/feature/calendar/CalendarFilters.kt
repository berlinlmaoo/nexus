package id.znetworks.nexus.feature.calendar

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.util.Locale

/**
 * Filters, in the screen itself (a side panel when expanded) — not a dialog, so it is edge-to-edge
 * with no scrim (audit #12, #24). The scope (Everyone / Mine / My division) is not here: it is a view,
 * shown once on the screen, and Reset leaves it alone (contract 2). Divisions, people
 * and projects (searchable, from the range on screen), priority, hide done, only overdue. Changes apply
 * live, so the top-left is a back arrow and the bottom button shows what you get (audit #39). Every
 * row is a ≥ 48 dp toggle with its role and state (audit #2, #10). One LazyColumn (audit #19).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun FiltersScreen(d: CalDerived, vm: CalendarViewModel, modifier: Modifier, onClose: () -> Unit) {
    val c = Nx.colors
    val f = d.s.filters
    fun set(x: CalendarCore.Filters) = vm.setFilters(x)
    var qPeople by rememberSaveable { mutableStateOf("") }
    var qProjects by rememberSaveable { mutableStateOf("") }
    BackHandler(onBack = onClose)
    val ids = d.all.flatMap { it.assigneeIds }.distinct()
    val people = ids.map { it to (d.name(it) ?: "") }.filter { qPeople.isBlank() || it.second.contains(qPeople.trim(), true) }
        .sortedWith { a, b -> CalendarCore.localeCompare(a.second, b.second) }
    val projects = d.all.mapNotNull { it.project }.distinctBy { it.id }
    val shownProjects = projects.filter { qProjects.isBlank() || it.name.contains(qProjects.trim(), true) }.sortedWith { a, b -> CalendarCore.localeCompare(a.name, b.name) }
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides c.foreground) {
    Column(modifier.background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.cal_filters), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground,
                modifier = Modifier.weight(1f).semantics { heading() })
            TextButton(onClick = { vm.resetFilters() }, enabled = d.filterCount > 0) { Text(stringResource(R.string.cal_reset)) }
        }
        HorizontalDivider(color = c.border)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
            item(key = "divh") { Header(stringResource(R.string.cal_divisions)) }
            items(d.ix.units, key = { "u:${it.id}" }) { u ->
                val on = u.id in f.units
                CheckRow(on, { set(f.copy(units = if (on) f.units - u.id else f.units + u.id)) }, Modifier.padding(start = (16 * u.depth).dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(d.color(u.id))); Spacer(Modifier.width(8.dp))
                    Text(if (u.isGroup) u.name.uppercase(Locale.getDefault()) else u.name, fontSize = if (u.isGroup) 12.sp else 14.sp,
                        fontWeight = if (u.isGroup) FontWeight.Bold else FontWeight.Normal, color = if (u.isGroup) c.mutedFg else c.foreground)
                }
            }
            item(key = "peopleh") {
                Header(stringResource(R.string.cal_people))
                OutlinedTextField(qPeople, { qPeople = it }, singleLine = true, placeholder = { Text(stringResource(R.string.cal_search_people)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
                if (ids.isEmpty()) Text(stringResource(R.string.cal_nobody_month), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(top = 4.dp))
            }
            items(people, key = { "p:${it.first}" }) { (id, name) ->
                val on = id in f.people
                CheckRow(on, { set(f.copy(people = if (on) f.people - id else f.people + id)) }) {
                    Initials(name, c.navy, 22); Spacer(Modifier.width(8.dp))
                    Text(name.ifEmpty { stringResource(R.string.cal_former_member) }, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            item(key = "projh") {
                Header(stringResource(R.string.cal_projects))
                OutlinedTextField(qProjects, { qProjects = it }, singleLine = true, placeholder = { Text(stringResource(R.string.cal_search_projects)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
                if (projects.isEmpty()) Text(stringResource(R.string.cal_no_project_month), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(top = 4.dp))
            }
            items(shownProjects, key = { "j:${it.id}" }) { p ->
                val on = p.id in f.projects
                CheckRow(on, { set(f.copy(projects = if (on) f.projects - p.id else f.projects + p.id)) }) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(CalIndex.hex(p.color ?: "#64748b"))); Spacer(Modifier.width(8.dp))
                    Text(p.name, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            item(key = "prio") {
                Header(stringResource(R.string.cal_priority))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("URGENT" to R.string.cal_prio_urgent, "HIGH" to R.string.cal_prio_high, "MEDIUM" to R.string.cal_prio_medium, "LOW" to R.string.cal_prio_low, "NONE" to R.string.cal_prio_none)
                        .forEach { (k, label) ->
                            val on = k in f.priorities
                            FilterChip(selected = on, onClick = { set(f.copy(priorities = if (on) f.priorities - k else f.priorities + k)) }, label = { Text(stringResource(label)) })
                        }
                }
            }
            item(key = "toggles") {
                Spacer(Modifier.height(8.dp))
                Toggle(stringResource(R.string.cal_hide_done), f.hideDone) { set(f.copy(hideDone = it)) }
                Toggle(stringResource(R.string.cal_only_overdue), f.overdueOnly) { set(f.copy(overdueOnly = it)) }
            }
        }
        // The live result, and the way back to it.
        val n = d.shown.count { if (d.s.view == CalView.MONTH) CalendarCore.sameMonth(it.day, d.s.day) else true }
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp).height(52.dp)) {
            Text(pluralStringResource(R.plurals.cal_show_n_tasks, n, n))
        }
    }
    }
}

@Composable
private fun Header(title: String) {
    Text(title.uppercase(Locale.getDefault()), style = MicroLabel, color = Nx.colors.mutedFg,
        modifier = Modifier.padding(top = 18.dp, bottom = 6.dp).semantics { heading() })
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Header(title); content() }
}

/** One focus stop: label and checked state together, role Checkbox, ≥ 48 dp. */
@Composable
private fun CheckRow(on: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = on, role = Role.Checkbox, onValueChange = { onToggle() }).then(modifier),
        verticalAlignment = Alignment.CenterVertically) {
        Checkbox(on, null); Spacer(Modifier.width(4.dp))
        content()
    }
}

/** One focus stop: label and switch state together, role Switch. */
@Composable
private fun Toggle(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = on, role = Role.Switch, onValueChange = onChange), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = Nx.colors.foreground, modifier = Modifier.weight(1f))
        Switch(on, null)
    }
}
