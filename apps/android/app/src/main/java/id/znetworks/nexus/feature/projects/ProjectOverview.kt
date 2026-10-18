package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.i18n.AppDateFormats

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.ViewWeek
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.AvatarStack
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The status bar's colours, in the order work moves (web: open slate, in progress sky, review violet, done green). */
@Composable
private fun statusTone(key: String): Color = when (key) {
    "IN_PROGRESS" -> Nx.colors.blue
    "IN_REVIEW" -> Nx.colors.violet
    "DONE" -> Nx.colors.success
    "CANCELLED" -> Nx.colors.mutedFg.copy(alpha = 0.35f)
    else -> Nx.colors.mutedFg.copy(alpha = 0.6f)
}

@Composable
private fun statusName(key: String) = stringResource(when (key) {
    "IN_PROGRESS" -> R.string.tstatus_in_progress; "IN_REVIEW" -> R.string.tstatus_in_review; "DONE" -> R.string.tstatus_done
    "CANCELLED" -> R.string.tstatus_cancelled; else -> R.string.tstatus_todo
})

@Composable
private fun priorityName(key: String) = if (key == "NONE") stringResource(R.string.ov_no_priority) else priorityLabel(key)

/**
 * The Overview tab of a task project (SPRINTS-OVERVIEW §3): progress, five counts that open the Board filtered,
 * deadlines, who carries what, the brief, open work by priority, sections, recently done, status updates.
 * One column on a phone; main + side from 840dp, as the web's 8/4 grid.
 */
@Composable
fun ProjectOverview(d: ProjectDetail, lanes: List<Lane>, onOpenTask: (String) -> Unit, onDrill: (OverviewDrill) -> Unit, onEditBrief: () -> Unit, onAddTask: () -> Unit) {
    val m = remember(lanes, d.members) { OverviewLogic.compute(lanes, d.members) }
    val wide = LocalConfiguration.current.screenWidthDp >= 840
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (m.total == 0) {
            EmptyState(Icons.Filled.ViewWeek, stringResource(R.string.ov_empty_title), stringResource(R.string.ov_empty_body), stringResource(R.string.board_add_task), onAddTask, Modifier.fillMaxWidth())
            BriefCard(d, onEditBrief)
            StatusUpdatesCard(d.id)
            return@Column
        }
        val main: @Composable ColumnScope.() -> Unit = {
            ProgressCard(m, onDrill)
            DeadlinesCard(m, onOpenTask, onDrill)
            TeamCard(m, onDrill)
        }
        val side: @Composable ColumnScope.() -> Unit = {
            BriefCard(d, onEditBrief)
            PriorityCard(m, onDrill)
            if (m.sections.size > 1) SectionsCard(m, onDrill)
            RecentlyDoneCard(m, onOpenTask)
            StatusUpdatesCard(d.id)
        }
        if (wide) Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(14.dp), content = main)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp), content = side)
        } else { main(); side() }
    }
}

@Composable
private fun Card(title: String, icon: ImageVector, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(16.dp), tint = c.mutedFg); Spacer(Modifier.width(8.dp))
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            action?.invoke()
        }
        HorizontalDivider(color = c.border)
        content()
    }
}

@Composable
private fun Note(text: String) = Text(text, fontSize = 13.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp))

@Composable
private fun MoreToggle(all: Boolean, hidden: Int, onToggle: () -> Unit) {
    TextButton(onClick = onToggle, modifier = Modifier.padding(horizontal = 4.dp)) {
        Text(if (all) stringResource(R.string.ov_show_fewer) else pluralStringResource(R.plurals.ov_show_more, hidden, hidden), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProgressCard(m: OverviewMetrics, onDrill: (OverviewDrill) -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))) {
        Column(Modifier.padding(14.dp)) {
            Text(stringResource(R.string.ov_progress), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${m.pct}%", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.ov_done_of, m.done, m.total), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(bottom = 4.dp))
            }
            Text(if (m.doneLast7 > 0) pluralStringResource(R.plurals.ov_done_last7, m.doneLast7, m.doneLast7) else stringResource(R.string.ov_done_last7_none),
                fontSize = 12.sp, color = c.mutedFg)
            Spacer(Modifier.height(12.dp))
            val parts = OverviewLogic.STATUSES.filter { (m.byStatus[it] ?: 0) > 0 }
            val label = parts.map { statusName(it) + " " + m.byStatus[it] }.joinToString(", ")
            Row(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(c.muted).semantics { contentDescription = label },
                horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                parts.forEach { k -> Box(Modifier.weight((m.byStatus[k] ?: 0).toFloat()).height(12.dp).background(statusTone(k))) }
            }
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                OverviewLogic.STATUSES.filter { (m.byStatus[it] ?: 0) > 0 || it == "TODO" || it == "DONE" }.forEach { k ->
                    val n = m.byStatus[k] ?: 0
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).background(statusTone(k), CircleShape)); Spacer(Modifier.width(5.dp))
                        Text(statusName(k), fontSize = 12.sp, color = c.mutedFg); Spacer(Modifier.width(4.dp))
                        Text("$n", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground); Spacer(Modifier.width(3.dp))
                        Text("${Math.round(n * 100f / m.total)}%", fontSize = 12.sp, color = c.mutedFg)
                    }
                }
            }
        }
        HorizontalDivider(color = c.border)
        // Open is wide (a row of its own) on a phone, as the web's col-span-2.
        val counts = listOf(
            Triple(R.string.ov_open, m.open, OverviewDrill()),
            Triple(R.string.overview_overdue, m.overdue.size, OverviewDrill(due = "OVERDUE")),
            Triple(R.string.ov_next7, m.next7, OverviewDrill(due = "NEXT7")),
            Triple(R.string.ov_no_due, m.noDue, OverviewDrill(due = "NONE")),
            Triple(R.string.ov_unassigned, m.unassigned, OverviewDrill(assigneeId = "NONE")),
        )
        val hints = listOf(R.plurals.ov_hint_open, R.plurals.ov_hint_overdue, R.plurals.ov_hint_next7, R.plurals.ov_hint_nodue, R.plurals.ov_hint_unassigned)
        @Composable fun Count(i: Int, mod: Modifier) {
            val (label, n, drill) = counts[i]
            val hint = pluralStringResource(hints[i], n, n)
            Column(mod.clickable(enabled = n > 0) { onDrill(drill) }.semantics { if (n > 0) contentDescription = hint }.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(stringResource(label), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("$n", fontSize = 20.sp, fontWeight = FontWeight.SemiBold,
                    color = when { n == 0 -> c.mutedFg.copy(alpha = 0.6f); i == 1 -> c.danger; else -> c.foreground })
            }
        }
        Row(Modifier.fillMaxWidth()) { Count(0, Modifier.weight(1f)) }
        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth()) { Count(1, Modifier.weight(1f)); Count(2, Modifier.weight(1f)) }
        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth()) { Count(3, Modifier.weight(1f)); Count(4, Modifier.weight(1f)) }
    }
}

@Composable
private fun dueLabel(t: BoardTask): String {
    val d = OverviewLogic.dueIn(t, OfficeTime.today()) ?: return ""
    return when {
        d < 0 -> pluralStringResource(R.plurals.ov_days_late, (-d).toInt(), (-d).toInt())
        d == 0L -> stringResource(R.string.ov_today)
        d == 1L -> stringResource(R.string.ov_tomorrow)
        else -> dueDate(t.dueDate)?.let { AppDateFormats.ofPattern("EEE, d MMM", Locale.getDefault()).format(it) }.orEmpty()
    }
}

@Composable
private fun TaskRow(t: BoardTask, section: String?, late: Boolean, onOpen: () -> Unit) {
    val c = Nx.colors
    val s = OverviewLogic.status(t)
    val pr = t.priority?.uppercase()
    Row(Modifier.fillMaxWidth().clickable(onClick = onOpen).heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(14.dp).border(2.dp, if (s == "IN_PROGRESS" || s == "IN_REVIEW") c.blue else c.mutedFg.copy(alpha = 0.5f), CircleShape))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            section?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (pr == "URGENT" || pr == "HIGH") { PriorityChip(pr, Modifier.padding(start = 6.dp)) }
        val people = t.assignees.map { (it.user?.name ?: it.user?.email) to it.user?.avatar }
        if (people.isNotEmpty()) { Spacer(Modifier.width(6.dp)); AvatarStack(people, 22.dp, max = 2, userIds = t.assignees.map { it.userId ?: it.user?.id }) }
        Text(dueLabel(t), fontSize = 12.sp, fontWeight = if (late) FontWeight.SemiBold else FontWeight.Normal, color = if (late) c.danger else c.mutedFg,
            textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.widthIn(min = 64.dp).padding(start = 8.dp))
    }
}

@Composable
private fun DeadlinesCard(m: OverviewMetrics, onOpenTask: (String) -> Unit, onDrill: (OverviewDrill) -> Unit) {
    val c = Nx.colors
    var allLate by rememberSaveable { mutableStateOf(false) }
    var allSoon by rememberSaveable { mutableStateOf(false) }
    val sectionOf = m.sections.associate { it.id to it.name }
    fun section(t: BoardTask) = t.taskList?.name ?: t.taskListId?.let { sectionOf[it] }
    Card(stringResource(R.string.ov_deadlines), Icons.Filled.Event) {
        if (m.overdue.isEmpty() && m.upcoming.isEmpty()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 16.dp)) {
                Text(stringResource(if (m.open == 0) R.string.ov_nothing_open else R.string.ov_nothing_due), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground)
                if (m.noDue > 0) {
                    Text(pluralStringResource(R.plurals.ov_no_due_hint, m.noDue, m.noDue), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(top = 4.dp))
                    TextButton(onClick = { onDrill(OverviewDrill(due = "NONE")) }) { Text(stringResource(R.string.ov_show_them), fontWeight = FontWeight.SemiBold) }
                }
            }
            return@Card
        }
        if (m.overdue.isNotEmpty()) {
            Head(stringResource(R.string.overview_overdue), m.overdue.size, c.danger)
            (if (allLate) m.overdue else m.overdue.take(5)).forEach { t -> TaskRow(t, section(t), late = true) { onOpenTask(t.id) } }
            if (m.overdue.size > 5) MoreToggle(allLate, m.overdue.size - 5) { allLate = !allLate }
            HorizontalDivider(color = c.border)
        }
        Head(stringResource(R.string.ov_next14), m.upcoming.size, c.mutedFg)
        if (m.upcoming.isEmpty()) Text(stringResource(R.string.ov_nothing_14), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp))
        (if (allSoon) m.upcoming else m.upcoming.take(5)).forEach { t -> TaskRow(t, section(t), late = false) { onOpenTask(t.id) } }
        if (m.upcoming.size > 5) MoreToggle(allSoon, m.upcoming.size - 5) { allSoon = !allSoon }
        Spacer(Modifier.height(6.dp))
    }
}

@Composable
private fun Head(text: String, n: Int, tone: Color) {
    Row(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 4.dp)) {
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tone); Spacer(Modifier.width(6.dp))
        Text("$n", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = tone)
    }
}

@Composable
private fun TeamCard(m: OverviewMetrics, onDrill: (OverviewDrill) -> Unit) {
    val c = Nx.colors
    var all by rememberSaveable { mutableStateOf(false) }
    val max = maxOf(1, m.people.maxOfOrNull { it.open } ?: 0, m.unassigned)
    Card(stringResource(R.string.ov_team), Icons.Filled.Groups) {
        if (m.people.isEmpty()) { Note(stringResource(R.string.ov_team_empty)); return@Card }
        @Composable fun Nums(open: Int, overdue: Int?, doneMonth: Int?) {
            @Composable fun N(n: Int?, bad: Boolean = false) = Text(n?.toString() ?: "", fontSize = 13.sp, textAlign = TextAlign.End,
                fontWeight = if ((n ?: 0) > 0) FontWeight.SemiBold else FontWeight.Normal,
                color = when { n == null -> c.mutedFg; n == 0 -> c.mutedFg.copy(alpha = 0.6f); bad -> c.danger; else -> c.foreground }, modifier = Modifier.width(52.dp))
            N(open); N(overdue, bad = true); N(doneMonth)
        }
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 2.dp)) {
            Text(stringResource(R.string.ov_person), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
            listOf(R.string.ov_open, R.string.overview_overdue, R.string.ov_done_month).forEach {
                Text(stringResource(it), fontSize = 11.sp, color = c.mutedFg, textAlign = TextAlign.End, maxLines = 2, lineHeight = 12.sp, modifier = Modifier.width(52.dp))
            }
        }
        (if (all) m.people else m.people.take(8)).forEach { p ->
            Row(Modifier.fillMaxWidth().clickable(enabled = p.open > 0) { onDrill(OverviewDrill(assigneeId = p.id)) }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Avatar(p.name, p.avatar, 28.dp, userId = p.id); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        if (p.lead) Text(stringResource(R.string.ov_lead), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.violetText,
                            modifier = Modifier.padding(start = 6.dp).background(c.violet.copy(alpha = 0.1f), CircleShape).padding(horizontal = 6.dp))
                    }
                    LoadBar(p.open.toFloat() / max, c.violet.copy(alpha = 0.7f))
                }
                Nums(p.open, p.overdue, p.doneMonth)
            }
        }
        if (m.unassigned > 0) Row(Modifier.fillMaxWidth().clickable { onDrill(OverviewDrill(assigneeId = "NONE")) }.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(28.dp).border(2.dp, c.border, CircleShape)); Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.ov_unassigned), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
                LoadBar(m.unassigned.toFloat() / max, c.mutedFg.copy(alpha = 0.4f))
            }
            Nums(m.unassigned, null, null)
        }
        if (m.people.size > 8) MoreToggle(all, m.people.size - 8) { all = !all }
        Spacer(Modifier.height(6.dp))
    }
}

@Composable
private fun LoadBar(f: Float, tone: Color) {
    Box(Modifier.padding(top = 4.dp).widthIn(max = 160.dp).fillMaxWidth().height(4.dp).clip(CircleShape).background(Nx.colors.muted)) {
        Box(Modifier.fillMaxWidth(f.coerceIn(0f, 1f)).height(4.dp).background(tone, CircleShape))
    }
}

@Composable
private fun BriefCard(d: ProjectDetail, onEdit: () -> Unit) {
    val c = Nx.colors
    val brief = d.description?.trim().orEmpty()
    var expanded by rememberSaveable { mutableStateOf(false) }
    Card(stringResource(R.string.ov_brief), Icons.Filled.Description, action = if (brief.isNotEmpty()) ({ TextButton(onClick = onEdit) { Text(stringResource(R.string.ov_edit), fontSize = 12.sp) } }) else null) {
        Column(Modifier.padding(14.dp)) {
            if (brief.isNotEmpty()) {
                val long = brief.length > 280
                Text(brief, fontSize = 14.sp, lineHeight = 20.sp, color = c.foreground, maxLines = if (long && !expanded) 6 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
                if (long) TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.ov_show_less else R.string.ov_read_more), fontSize = 12.sp) }
            } else {
                Text(stringResource(R.string.ov_brief_empty), fontSize = 13.sp, color = c.mutedFg)
                OutlinedButton(onClick = onEdit, modifier = Modifier.padding(top = 10.dp)) {
                    Icon(Icons.Filled.Edit, null, Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.ov_write_brief))
                }
            }
            HorizontalDivider(color = c.border, modifier = Modifier.padding(vertical = 12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (d.members.isNotEmpty()) AvatarStack(d.members.map { (it.user?.name ?: it.user?.email) to it.user?.avatar }, 26.dp, max = 6, userIds = d.members.map { it.uid })
                else Icon(Icons.Filled.Groups, null, Modifier.size(16.dp), tint = c.mutedFg)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(pluralStringResource(R.plurals.ov_members, d.members.size, d.members.size), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.foreground)
                    val leads = d.members.filter { it.role.equals("LEAD", true) }.mapNotNull { it.user?.name ?: it.user?.email }
                    if (leads.isNotEmpty()) Text(stringResource(R.string.ov_led_by, leads.joinToString(", ")), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun PriorityCard(m: OverviewMetrics, onDrill: (OverviewDrill) -> Unit) {
    val c = Nx.colors
    Card(stringResource(R.string.ov_by_priority), Icons.Filled.PriorityHigh) {
        if (m.open == 0) { Note(stringResource(R.string.ov_all_closed)); return@Card }
        Column(Modifier.padding(vertical = 6.dp)) {
            OverviewLogic.PRIORITIES.filter { it != "NONE" || (m.byPriority["NONE"] ?: 0) > 0 }.forEach { k ->
                val n = m.byPriority[k] ?: 0
                val tone = priorityColor(k)
                Row(Modifier.fillMaxWidth().clickable(enabled = n > 0) { onDrill(OverviewDrill(priority = k)) }.heightIn(min = 44.dp).padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(96.dp)) {
                        Text(priorityName(k), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = if (k == "NONE") c.mutedFg else tone,
                            modifier = Modifier.background((if (k == "NONE") c.muted else tone.copy(alpha = 0.15f)), CircleShape).padding(horizontal = 8.dp, vertical = 2.dp))
                    }
                    Box(Modifier.weight(1f).height(6.dp).clip(CircleShape).background(c.muted)) {
                        Box(Modifier.fillMaxWidth(n.toFloat() / m.open).height(6.dp).background(tone, CircleShape))
                    }
                    Text("$n", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (n == 0) c.mutedFg.copy(alpha = 0.6f) else c.foreground,
                        textAlign = TextAlign.End, modifier = Modifier.width(36.dp))
                }
            }
        }
    }
}

@Composable
private fun SectionsCard(m: OverviewMetrics, onDrill: (OverviewDrill) -> Unit) {
    val c = Nx.colors
    Card(stringResource(R.string.ov_sections), Icons.Filled.ViewWeek) {
        Column(Modifier.padding(vertical = 6.dp)) {
            m.sections.forEach { s ->
                Column(Modifier.fillMaxWidth().clickable(enabled = s.open > 0) { onDrill(OverviewDrill(section = s.id)) }.padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Row {
                        Text(s.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(if (s.total > 0) stringResource(R.string.ov_section_counts, s.open, s.done) else stringResource(R.string.ov_section_empty), fontSize = 12.sp, color = c.mutedFg)
                    }
                    Box(Modifier.padding(top = 6.dp).fillMaxWidth().height(4.dp).clip(CircleShape).background(c.muted)) {
                        Box(Modifier.fillMaxWidth(if (s.total > 0) s.done.toFloat() / s.total else 0f).height(4.dp).background(c.success, CircleShape))
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentlyDoneCard(m: OverviewMetrics, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val byId = m.people.associateBy { it.id }
    Card(stringResource(R.string.ov_recent_done), Icons.Filled.CheckCircle) {
        if (m.completed.isEmpty()) { Note(stringResource(R.string.ov_recent_empty)); return@Card }
        Column(Modifier.padding(vertical = 4.dp)) {
            m.completed.take(6).forEach { t ->
                val by = t.completedById?.let { byId[it] }
                val ago = OverviewLogic.completedOn(t)?.let { DateUtils.getRelativeTimeSpanString(it.toEpochMilli(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString() }
                Row(Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(14.dp).background(c.success, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Check, null, Modifier.size(10.dp), tint = Color.White) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.title, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val line = listOfNotNull(by?.name?.let { stringResource(R.string.ov_by, it) }, ago).joinToString(" · ")
                        if (line.isNotEmpty()) Text(line, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    by?.let { Avatar(it.name, it.avatar, 22.dp, userId = it.id) }
                }
            }
        }
    }
}

@Composable
private fun StatusUpdatesCard(projectId: String) {
    val c = Nx.colors
    val ctx = LocalContext.current
    val api = remember { ProjectsApi((ctx.applicationContext as NexusApplication).container.api) }
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<StatusUpdate>?>(null) }
    var text by rememberSaveable { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    var drafting by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<Int?>(null) }
    var all by rememberSaveable { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(projectId, reload) { rows = runCatching { api.statusUpdates(projectId) }.getOrElse { rows ?: emptyList() } }
    Card(stringResource(R.string.ov_updates), Icons.Filled.AutoAwesome, action = {
        TextButton(onClick = {
            drafting = true; problem = null
            scope.launch { try { text = api.draftStatusUpdate(projectId) } catch (e: ApiError) { problem = R.string.ov_draft_failed }; drafting = false }
        }, enabled = !drafting) {
            if (drafting) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp) else id.znetworks.nexus.ui.components.GideonMark(14.dp)
            Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.ov_draft_ai), fontSize = 12.sp)
        }
    }) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(text, { text = it }, placeholder = { Text(stringResource(R.string.ov_update_hint), fontSize = 13.sp) },
                minLines = if (text.isBlank()) 2 else 4, modifier = Modifier.fillMaxWidth())
            problem?.let { Text(stringResource(it), fontSize = 12.sp, color = c.dangerText) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(onClick = {
                    posting = true; problem = null
                    scope.launch {
                        try { api.postStatusUpdate(projectId, text); text = ""; reload++ } catch (e: ApiError) { problem = R.string.ov_post_failed }
                        posting = false
                    }
                }, enabled = text.isNotBlank() && !posting) {
                    if (posting) { CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White); Spacer(Modifier.width(6.dp)) }
                    Text(stringResource(R.string.ov_post))
                }
            }
            val list = rows
            when {
                list == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                list.isEmpty() -> Text(stringResource(R.string.ov_updates_empty), fontSize = 13.sp, color = c.mutedFg)
                else -> {
                    (if (all) list else list.take(3)).forEach { u ->
                        HorizontalDivider(color = c.border)
                        Column(Modifier.padding(vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(u.author?.name, u.author?.avatar, 22.dp, userId = u.author?.id); Spacer(Modifier.width(8.dp))
                                Text(u.author?.name ?: stringResource(R.string.ov_someone), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                updateStatus(u.status)?.let { Text(stringResource(it), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                                    modifier = Modifier.padding(start = 6.dp).background(c.muted, CircleShape).padding(horizontal = 6.dp)) }
                                Spacer(Modifier.weight(1f))
                                Text(updateDate(u.createdAt), fontSize = 12.sp, color = c.mutedFg)
                            }
                            Text(u.text, fontSize = 14.sp, lineHeight = 20.sp, color = c.foreground, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                    if (list.size > 3) TextButton(onClick = { all = !all }) {
                        Text(if (all) stringResource(R.string.ov_show_fewer) else stringResource(R.string.ov_show_all_updates, list.size), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

private fun updateStatus(s: String?): Int? = when (s?.uppercase()) {
    "ON_TRACK" -> R.string.ov_on_track; "AT_RISK" -> R.string.ov_at_risk; "OFF_TRACK" -> R.string.ov_off_track; else -> null
}

private fun updateDate(iso: String?): String {
    val at = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return ""
    val day = at.atZone(OfficeTime.ZONE).toLocalDate()
    val pattern = if (day.year == OfficeTime.today().year) "d MMM" else "d MMM yyyy"
    return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(day)
}
