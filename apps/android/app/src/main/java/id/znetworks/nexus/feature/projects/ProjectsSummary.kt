package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

/** The Projects page's summary, filter and order (iOS ProjectsView / ProjectsSummaryCard, web projects/index.tsx). */
object ProjectsLogic {
    val STATUSES = listOf("all", "ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "ARCHIVED")
    val SORTS = listOf("energy", "tasks", "name")

    /** Over every project, not only the filtered ones. Null figures = the per-project tallies are still being counted ("–"). */
    data class Summary(val progressPct: Int?, val done: Int?, val members: Int)

    fun summary(projects: List<Project>, tallies: Map<String, Tally>?): Summary {
        // Distinct people, not memberships summed over projects (web QA 13 Oct 2026).
        val members = projects.flatMap { p -> p.members.mapNotNull { it.user?.id ?: it.userId } }.toSet().size
        if (tallies.isNullOrEmpty()) return Summary(null, null, members)
        val total = tallies.values.sumOf { it.total }; val done = tallies.values.sumOf { it.done }
        return Summary(if (total > 0) Math.round(done * 100.0 / total).toInt() else 0, done, members)
    }

    private fun progress(p: Project, tallies: Map<String, Tally>) = tallies[p.id]?.takeIf { it.total > 0 }?.let { it.done.toDouble() / it.total } ?: 0.0

    /** The projects the filter lets through, in the chosen order; ties by name so the order holds between redraws. */
    fun visible(projects: List<Project>, status: String, sort: String, tallies: Map<String, Tally>): List<Project> {
        val byName = compareBy<Project> { it.name.lowercase() }
        val cmp = when (sort) {
            "name" -> byName
            "tasks" -> compareByDescending<Project> { it.taskCount }.then(byName)
            else -> compareByDescending<Project> { progress(it, tallies) }.then(byName)
        }
        return projects.filter { status == "all" || (it.status ?: "ACTIVE").uppercase() == status }.sortedWith(cmp)
    }
}

@Composable
private fun statusLabel(k: String) = stringResource(when (k) {
    "ACTIVE" -> R.string.psum_active; "PLANNING" -> R.string.psum_planning; "ON_HOLD" -> R.string.psum_on_hold
    "COMPLETED" -> R.string.psum_completed; "ARCHIVED" -> R.string.psum_archived; else -> R.string.psum_all
})

@Composable
private fun sortLabel(k: String) = stringResource(when (k) { "tasks" -> R.string.psum_sort_tasks; "name" -> R.string.psum_sort_name; else -> R.string.psum_sort_progress })

/** "N of M projects", average progress · tasks done · members, then Filters (status) and the order. */
@Composable
fun ProjectsSummaryCard(shown: Int, total: Int, sum: ProjectsLogic.Summary, status: String, sort: String, onStatus: (String) -> Unit, onSort: (String) -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(20.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.clip(CircleShape).background(c.muted).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AutoAwesome, null, tint = c.foreground, modifier = Modifier.size(13.dp)); Spacer(Modifier.width(6.dp))
            Text(pluralStringResource(R.plurals.psum_n_of_m, total, shown, total), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Stat(Icons.Outlined.TrackChanges, sum.progressPct?.let { "$it%" } ?: "–", stringResource(R.string.psum_avg_progress), Modifier.weight(1f))
            Stat(Icons.Outlined.CheckCircle, sum.done?.toString() ?: "–", stringResource(R.string.psum_tasks_done), Modifier.weight(1f))
            Stat(Icons.Outlined.Group, sum.members.toString(), stringResource(R.string.psum_members), Modifier.weight(1f))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Tune, null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
            Text(stringResource(R.string.psum_filters), fontSize = 13.sp, color = c.mutedFg)
            MenuPill(statusLabel(status), ProjectsLogic.STATUSES, { statusLabel(it) }, status, onStatus)
            MenuPill(sortLabel(sort), ProjectsLogic.SORTS, { sortLabel(it) }, sort, onSort)
        }
    }
}

@Composable
private fun Stat(icon: ImageVector, value: String, label: String, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(c.background).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, null, tint = c.foreground, modifier = Modifier.size(16.dp))
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        // Two lines when a phone is narrow ("Average progress" was cut to "Average"); iOS shrinks the text instead.
        Text(label, fontSize = 11.sp, lineHeight = 13.sp, color = c.mutedFg, maxLines = 2, minLines = 2)
    }
}

@Composable
private fun MenuPill(shown: String, options: List<String>, label: @Composable (String) -> String, selected: String, onPick: (String) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.clip(CircleShape).background(c.background).border(1.dp, c.border, CircleShape).clickable { open = true }.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(shown, fontSize = 13.sp, color = c.foreground, maxLines = 1)
            Icon(Icons.Filled.KeyboardArrowDown, null, tint = c.foreground, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(open, { open = false }) {
            options.forEach { o ->
                DropdownMenuItem(text = { Text(label(o)) }, leadingIcon = { if (o == selected) Icon(Icons.Filled.Check, null) }, onClick = { open = false; onPick(o) })
            }
        }
    }
}

