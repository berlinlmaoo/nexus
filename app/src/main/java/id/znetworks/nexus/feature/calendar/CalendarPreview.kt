package id.znetworks.nexus.feature.calendar

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.tasks.TaskApi
import id.znetworks.nexus.feature.tasks.TaskDetail
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/** "Saturday, 3 October 2026" (+ " · 19.00" when it has a time) of a due instant, in WIB. */
internal fun dueText(iso: String?): String? {
    val z = iso?.let { runCatching { Instant.parse(it).atZone(OfficeTime.ZONE) }.getOrNull() } ?: return null
    val date = DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.getDefault()).format(z).replaceFirstChar { it.titlecase(Locale.getDefault()) }
    val utcMidnight = Instant.parse(iso).epochSecond % 86_400 == 0L
    return if (utcMidnight || (z.hour == 0 && z.minute == 0)) date else "$date · ${clock("%02d:%02d".format(z.hour, z.minute))}"
}

/**
 * A task the viewer cannot edit (not a member of its project), read only and full screen: title,
 * status, due (WIB), priority, project, people, description, subtasks, comments, under the banner
 * "Read only · you are not a member of <project>". Masked rows never get here.
 */
@Composable
internal fun TaskPreview(taskId: String, projectName: String?, onClose: () -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val api = remember { TaskApi(container.api, container.uploads) }
    var task by remember(taskId) { mutableStateOf<TaskDetail?>(null) }
    var failed by remember(taskId) { mutableStateOf(false) }
    LaunchedEffect(taskId) { runCatching { api.task(taskId).value }.onSuccess { task = it }.onFailure { failed = true } }
    BackHandler(onBack = onClose)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding()) {
            val project = projectName ?: task?.taskList?.project?.name
            Row(Modifier.fillMaxWidth().background(Color(0xFFFFF7E0)).padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Visibility, null, tint = Color(0xFF8A5A00), modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                Text(project?.let { stringResource(R.string.cal_read_only_of, it) } ?: stringResource(R.string.cal_read_only), fontSize = 13.sp, color = Color(0xFF8A5A00), modifier = Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.cal_close), tint = Color(0xFF8A5A00)) }
            }
            val t = task
            when {
                t == null && !failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                t == null -> Text(stringResource(R.string.cal_task_failed), color = c.mutedFg, modifier = Modifier.padding(20.dp))
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(t.title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                    Fact(stringResource(R.string.cal_status)) {
                        Text(statusLabel(t.status), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                            modifier = Modifier.clip(CircleShape).background(c.muted).padding(horizontal = 10.dp, vertical = 2.dp))
                    }
                    Fact(stringResource(R.string.cal_due)) { Text(dueText(t.dueDate) ?: stringResource(R.string.cal_no_due), fontSize = 14.sp, color = c.foreground) }
                    Fact(stringResource(R.string.cal_priority)) { Text(prioLabel(t.priority), fontSize = 14.sp, color = c.foreground) }
                    project?.let { p -> Fact(stringResource(R.string.cal_project)) { Text(p, fontSize = 14.sp, color = c.foreground) } }
                    Fact(stringResource(R.string.cal_people)) {
                        val names = t.assignees.mapNotNull { it.user?.name }
                        if (names.isEmpty()) Text(stringResource(R.string.cal_nobody_yet), fontSize = 14.sp, color = c.mutedFg)
                        else Column { names.forEach { n -> Row(verticalAlignment = Alignment.CenterVertically) { Initials(n, Color(0xFF1E3A5F), 20); Spacer(Modifier.width(6.dp)); Text(n, fontSize = 14.sp, color = c.foreground) } } }
                    }
                    if (t.descriptionText.isNotBlank()) Block(stringResource(R.string.cal_description)) {
                        Text(t.descriptionText, fontSize = 14.sp, color = c.foreground, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)).padding(12.dp))
                    }
                    if (t.subtasks.isNotEmpty()) Block(stringResource(R.string.cal_subtasks)) {
                        t.subtasks.forEach { st ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                                if (st.isDone) Box(Modifier.size(16.dp).clip(CircleShape).background(c.success), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(11.dp)) }
                                else Box(Modifier.size(16.dp).clip(CircleShape).border(1.5.dp, c.mutedFg, CircleShape))
                                Spacer(Modifier.width(8.dp))
                                Text(st.title, fontSize = 14.sp, color = if (st.isDone) c.mutedFg else c.foreground, textDecoration = if (st.isDone) TextDecoration.LineThrough else null)
                            }
                        }
                    }
                    if (t.comments.isNotEmpty()) Block(stringResource(R.string.cal_comments)) {
                        t.comments.forEach { cm ->
                            Row(Modifier.padding(vertical = 4.dp)) {
                                Initials(cm.user?.name, Color(0xFF5B4BD6), 24); Spacer(Modifier.width(8.dp))
                                Column {
                                    Text(listOfNotNull(cm.user?.name, commentTime(cm.createdAt)).joinToString(" · "), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                    Text(cm.content, fontSize = 14.sp, color = c.foreground)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "4 Okt, 15.12" in WIB. */
private fun commentTime(iso: String?): String? = iso?.let { runCatching { Instant.parse(it).atZone(OfficeTime.ZONE) }.getOrNull() }?.let { z ->
    DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()).format(z) + ", " + clock("%02d:%02d".format(z.hour, z.minute))
}

@Composable
private fun Fact(label: String, value: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.Top) {
        Text(label, fontSize = 13.sp, color = Nx.colors.mutedFg, modifier = Modifier.width(84.dp))
        value()
    }
}

@Composable
private fun Block(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = Nx.colors.mutedFg)
        content()
    }
}

@Composable
private fun statusLabel(s: String?): String = stringResource(when (s?.uppercase()) {
    "DONE" -> R.string.cal_status_done; "IN_PROGRESS" -> R.string.cal_status_progress; "IN_REVIEW", "REVIEW" -> R.string.cal_status_review
    "CANCELLED" -> R.string.cal_status_cancelled; null -> R.string.cal_no_status; else -> R.string.cal_status_todo
})

@Composable
private fun prioLabel(p: String?): String = stringResource(when (p?.uppercase()) {
    "URGENT" -> R.string.cal_prio_urgent; "HIGH" -> R.string.cal_prio_high; "LOW" -> R.string.cal_prio_low; "NONE" -> R.string.cal_prio_none; else -> R.string.cal_prio_medium
})
