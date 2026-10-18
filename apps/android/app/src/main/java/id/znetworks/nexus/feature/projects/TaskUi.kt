package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.AvatarStack
import id.znetworks.nexus.ui.theme.Nx
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun taskStatusLabel(s: String?): String = stringResource(
    when (s.orEmpty().uppercase()) {
        "IN_PROGRESS" -> R.string.tstatus_in_progress
        "IN_REVIEW" -> R.string.tstatus_in_review
        "DONE" -> R.string.tstatus_done
        "CANCELLED", "CANCELED" -> R.string.tstatus_cancelled
        else -> R.string.tstatus_todo
    },
)

@Composable
fun taskStatusColor(s: String?): Color = when (s.orEmpty().uppercase()) {
    "IN_PROGRESS" -> Nx.colors.blue
    "IN_REVIEW" -> Nx.colors.warning
    "DONE" -> Nx.colors.success
    "CANCELLED", "CANCELED" -> Nx.colors.mutedFg
    else -> Nx.colors.accentFg
}

@Composable
fun priorityLabel(p: String?): String = stringResource(
    when (p.orEmpty().uppercase()) {
        "URGENT" -> R.string.prio_urgent
        "HIGH" -> R.string.prio_high
        "MEDIUM" -> R.string.prio_medium
        "LOW" -> R.string.prio_low
        else -> R.string.prio_none
    },
)

@Composable
fun priorityColor(p: String?): Color = when (p.orEmpty().uppercase()) {
    "URGENT" -> Nx.colors.danger
    "HIGH" -> Nx.colors.priorityHighText
    "MEDIUM" -> Nx.colors.blue
    else -> Nx.colors.mutedFg   // LOW is neutral (AVATARS-PRIORITY)
}

@Composable
fun Pill(text: String, tone: Color) {
    Text(text, color = tone, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1,
        modifier = Modifier.background(tone.copy(alpha = 0.15f), CircleShape).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
fun TaskStatusChip(status: String?) = Pill(taskStatusLabel(status), taskStatusColor(status))

/**
 * The compact priority pill (owner, 10 Oct: "icon high itu kayaknya ke gedean"; AVATARS-PRIORITY): 10sp bold,
 * 7×2dp, one line that never wraps; it sits beside the title, which takes the rest of the width. NONE shows nothing.
 */
@Composable
fun PriorityChip(priority: String?, modifier: Modifier = Modifier) {
    if (priority.isNullOrBlank() || priority.equals("NONE", true)) return
    val tone = priorityColor(priority)
    Text(priorityLabel(priority), color = tone, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false,
        modifier = modifier.background(tone.copy(alpha = 0.15f), CircleShape).padding(horizontal = 7.dp, vertical = 2.dp))
}

/** "d MMM", red when an open task is overdue, amber when due today. */
@Composable
fun DueLabel(iso: String?, done: Boolean) {
    val d = dueDate(iso) ?: return
    val today = OfficeTime.today()
    val tone = when {
        done -> Nx.colors.mutedFg
        d.isBefore(today) -> Nx.colors.danger
        d == today -> Nx.colors.warning
        else -> Nx.colors.mutedFg
    }
    Text("📅 " + AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(d), fontSize = 11.sp, color = tone, fontWeight = FontWeight.SemiBold)
}

/**
 * One card, the same on the board, the list and My tasks: done toggle, title, "↳ Subtask ·
 * parent", priority, due, subtasks, comments, quest XP, assignees.
 */
@OptIn(ExperimentalFoundationApi::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun TaskCard(
    t: BoardTask,
    onClick: () -> Unit,
    onToggleDone: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    showProject: Boolean = false,
    modifier: Modifier = Modifier,
    /** Multi-select (TaskBulk): null = not selecting; true draws the card picked. */
    selected: Boolean? = null,
) {
    val c = Nx.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (selected == true) c.accentBg else c.card)
            .border(if (selected == true) 2.dp else 1.dp, if (selected == true) c.violet else c.border, RoundedCornerShape(16.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (t.isSubtask) {
            Text("↳ " + stringResource(R.string.task_subtask_of, t.parentTitle ?: "…"), fontSize = 10.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(verticalAlignment = Alignment.Top) {
            if (selected != null) {
                Icon(if (selected) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, null, Modifier.size(24.dp), tint = if (selected) c.violet else c.mutedFg)
                Spacer(Modifier.size(8.dp))
            }
            if (onToggleDone != null) {
                IconButton(onClick = onToggleDone, modifier = Modifier.size(48.dp)) {
                    Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, stringResource(R.string.task_toggle_done),
                        tint = if (t.isDone) c.success else c.mutedFg)
                }
                Spacer(Modifier.size(8.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(t.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = if (t.isDone) c.mutedFg else c.foreground,
                    textDecoration = if (t.isDone) TextDecoration.LineThrough else null, maxLines = 3, overflow = TextOverflow.Ellipsis)
                if (showProject) {
                    listOfNotNull(t.taskList?.project?.name, t.taskList?.name).takeIf { it.isNotEmpty() }?.let {
                        Text(it.joinToString(" · "), fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                    }
                }
            }
            // Top-right, one line: a long title wraps beside it instead of being squeezed by it.
            PriorityChip(t.priority, Modifier.padding(start = 8.dp, top = 2.dp))
        }
        FieldChipRow(t.customFieldValues)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            DueLabel(t.dueDate, t.isDone)
            if (t.subtasks.isNotEmpty()) Text("☑ ${t.doneSubs}/${t.subtasks.size}", fontSize = 11.sp, color = c.mutedFg)
            val comments = t.count?.comments ?: 0
            if (comments > 0) Text("💬 $comments", fontSize = 11.sp, color = c.mutedFg)
            if (t.questXp > 0) Pill("+${t.questXp} XP", c.violetText)
            Spacer(Modifier.weight(1f))
            if (t.assignees.isNotEmpty()) AvatarStack(t.assignees.map { it.user?.name to it.user?.avatar }, size = 22.dp)
        }
    }
}
