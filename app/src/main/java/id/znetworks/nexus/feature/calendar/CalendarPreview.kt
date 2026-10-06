package id.znetworks.nexus.feature.calendar

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import id.znetworks.nexus.ui.components.EmptyState
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
 * A task the viewer cannot edit (not a member of its project), read only — its own route
 * (`task-preview/{id}`), so it opens and goes back like the editable task screen (audit #38): back arrow,
 * title, a theme-aware "Read only · you are not a member of <project>" banner, then status, due (WIB),
 * priority, project, people, description, subtasks, comments. Failure offers Try again. Text is capped
 * at a readable width on tablets (audit #12). Masked rows never get here.
 */
@Composable
fun TaskPreviewScreen(taskId: String, projectName: String?, onBack: () -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val api = remember { TaskApi(container.api, container.uploads) }
    var task by remember(taskId) { mutableStateOf<TaskDetail?>(null) }
    var failed by remember(taskId) { mutableStateOf(false) }
    var attempt by remember(taskId) { mutableStateOf(0) }
    LaunchedEffect(taskId, attempt) { failed = false; runCatching { api.task(taskId).value }.onSuccess { task = it }.onFailure { failed = true } }
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides c.foreground) {
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.cal_task), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground,
                modifier = Modifier.weight(1f).semantics { heading() })
        }
        val project = projectName ?: task?.taskList?.project?.name
        Row(Modifier.fillMaxWidth().background(c.warningBg).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Visibility, null, tint = c.warningFg, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
            Text(project?.let { stringResource(R.string.cal_read_only_of, it) } ?: stringResource(R.string.cal_read_only), fontSize = 13.sp, color = c.warningFg, modifier = Modifier.weight(1f))
        }
        val t = task
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            when {
                t == null && !failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                t == null -> EmptyState(Icons.Filled.CloudOff, stringResource(R.string.cal_task_failed), stringResource(R.string.cal_check_connection),
                    stringResource(R.string.try_again), { attempt++ }, Modifier.fillMaxSize())
                else -> Column(Modifier.widthIn(max = 640.dp).fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(t.title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground, modifier = Modifier.semantics { heading() })
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
                        else Column { names.forEach { n -> Row(verticalAlignment = Alignment.CenterVertically) { Initials(n, c.navy, 20); Spacer(Modifier.width(6.dp)); Text(n, fontSize = 14.sp, color = c.foreground) } } }
                    }
                    if (t.descriptionText.isNotBlank()) Block(stringResource(R.string.cal_description)) {
                        Text(t.descriptionText, fontSize = 14.sp, color = c.foreground, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)).padding(12.dp))
                    }
                    if (t.subtasks.isNotEmpty()) Block(stringResource(R.string.cal_subtasks)) {
                        val done = doneWord; val todo = todoWord
                        t.subtasks.forEach { st ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp).semantics(mergeDescendants = true) {
                                stateDescription = if (st.isDone) done else todo }) {
                                if (st.isDone) Box(Modifier.size(16.dp).clip(CircleShape).background(c.success), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Check, null, tint = c.onSuccess, modifier = Modifier.size(11.dp)) }
                                else Box(Modifier.size(16.dp).clip(CircleShape).border(1.5.dp, c.mutedFg, CircleShape))
                                Spacer(Modifier.width(8.dp))
                                Text(st.title, fontSize = 14.sp, color = if (st.isDone) c.mutedFg else c.foreground, textDecoration = if (st.isDone) TextDecoration.LineThrough else null)
                            }
                        }
                    }
                    if (t.comments.isNotEmpty()) Block(stringResource(R.string.cal_comments)) {
                        t.comments.forEach { cm ->
                            Row(Modifier.padding(vertical = 4.dp)) {
                                Initials(cm.user?.name, c.navy, 24); Spacer(Modifier.width(8.dp))
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
}

private val doneWord @Composable get() = stringResource(R.string.cal_status_done)
private val todoWord @Composable get() = stringResource(R.string.cal_status_todo)

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
