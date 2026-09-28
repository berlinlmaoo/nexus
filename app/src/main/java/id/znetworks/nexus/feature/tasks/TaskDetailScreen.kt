package id.znetworks.nexus.feature.tasks

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.projects.BoardLogic
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TaskEnums
import id.znetworks.nexus.feature.projects.dueDate
import id.znetworks.nexus.feature.projects.priorityColor
import id.znetworks.nexus.feature.projects.priorityLabel
import id.znetworks.nexus.feature.projects.taskStatusColor
import id.znetworks.nexus.feature.projects.taskStatusLabel
import id.znetworks.nexus.feature.projects.valueText
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One task, whole (iOS TaskDetailView + TaskDetailExtrasView). */
@Composable
fun TaskDetailScreen(onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenProject: (String) -> Unit, vm: TaskDetailViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(s.deleted) { if (s.deleted) onBack() }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.td_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp,
                color = c.foreground, modifier = Modifier.weight(1f))
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            if (s.task != null) Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more)) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.td_delete), color = c.danger) },
                        leadingIcon = { Icon(Icons.Filled.Delete, null, tint = c.danger) }, onClick = { menu = false; confirmDelete = true })
                }
            }
        }
        Box(Modifier.weight(1f)) {
            val t = s.task
            when {
                s.loading && t == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                t == null -> EmptyState(Icons.Filled.Description, stringResource(R.string.td_load_failed), s.error.orEmpty(),
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg) }
                        Header(t, vm, onOpenTask)
                        QuestBanner(t, s.isBoD, vm)
                        MetaCard(t, s, vm, onOpenProject)
                        DescriptionCard(t, vm)
                        SubtasksCard(t, vm, onOpenTask)
                        FilesCard(s, vm)
                        DependenciesCard(s, vm, onOpenTask)
                        TimeCard(s, vm)
                        CommentsCard(t, vm)
                        ActivityCard(t)
                    }
                }
            }
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.td_delete_q)) },
        text = { Text(stringResource(R.string.td_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete() }) { Text(stringResource(R.string.delete), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
    s.actionError?.let {
        AlertDialog(onDismissRequest = vm::dismissError, title = { Text(stringResource(R.string.td_couldnt)) }, text = { Text(it) },
            confirmButton = { TextButton(onClick = vm::dismissError) { Text("OK") } })
    }
}

// region pieces

@Composable
private fun Card(content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

@Composable
private fun CardHeader(title: String, icon: ImageVector? = null, trailing: @Composable () -> Unit = {}) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        icon?.let { Icon(it, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
        Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
private fun Caption(text: String) =
    Text(text.uppercase(Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, color = Nx.colors.mutedFg)

@Composable
private fun Muted(text: String) = Text(text, fontSize = 13.sp, color = Nx.colors.mutedFg)

@Composable
private fun ControlChip(text: String, icon: ImageVector, tone: Color, onClick: () -> Unit) {
    Row(
        Modifier.clip(CircleShape).background(tone.copy(alpha = 0.14f), CircleShape).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tone, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(5.dp))
        Text(text, color = tone, fontWeight = FontWeight.Bold, fontSize = 12.sp, maxLines = 1)
        Text(" ▾", color = tone.copy(alpha = 0.6f), fontSize = 10.sp)
    }
}

private fun dayText(iso: String?): String? =
    dueDate(iso)?.let { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(it) }

/** "28 Sep, 14:05" in office time, for comments, files and time entries. */
internal fun whenText(iso: String?): String = iso?.let {
    runCatching { DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.getDefault()).format(Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta"))) }.getOrNull()
}.orEmpty()

internal fun sizeText(bytes: Long?): String = when {
    bytes == null -> ""
    bytes >= 1L shl 30 -> "%.1f GB".format(Locale.US, bytes / (1024.0 * 1024 * 1024))
    bytes >= 1L shl 20 -> "%.1f MB".format(Locale.US, bytes / (1024.0 * 1024))
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

internal fun minutesText(m: Int): String = if (m >= 60) "${m / 60}j ${m % 60}m" else "${m}m"

// endregion

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Header(t: TaskDetail, vm: TaskDetailViewModel, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    var title by rememberSaveable(t.id, t.title) { mutableStateOf(t.title) }
    var statusMenu by remember { mutableStateOf(false) }
    var prioMenu by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<String?>(null) } // "due" | "start"
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        t.parent?.let { p ->
            // A breadcrumb naming the parent has to reach it: Back goes wherever you came from.
            Row(Modifier.clip(CircleShape).background(c.accentBg, CircleShape).clickable { onOpenTask(p.id) }.padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.td_subtask_of) + " ", fontSize = 12.sp, color = c.accentFg.copy(alpha = 0.8f))
                Text(p.title ?: "…", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.accentFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        TextField(
            title, { title = it.replace("\n", "") },
            textStyle = TextStyle(fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = c.foreground),
            placeholder = { Text(stringResource(R.string.td_task_title)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { vm.setTitle(title) }),
            colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
            // Commits when focus leaves, like iOS.
            modifier = Modifier.fillMaxWidth().onFocusChanged { if (!it.isFocused && title != t.title) vm.setTitle(title) },
        )
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                ControlChip(taskStatusLabel(t.status), Icons.Filled.CheckCircle, taskStatusColor(t.status)) { statusMenu = true }
                DropdownMenu(statusMenu, { statusMenu = false }) {
                    TaskEnums.STATUSES.forEach { st -> DropdownMenuItem(text = { Text(taskStatusLabel(st)) }, onClick = { statusMenu = false; vm.setStatus(st) }) }
                }
            }
            Box {
                ControlChip(priorityLabel(t.priority), Icons.Filled.Flag, priorityColor(t.priority)) { prioMenu = true }
                DropdownMenu(prioMenu, { prioMenu = false }) {
                    TaskEnums.PRIORITIES.forEach { p -> DropdownMenuItem(text = { Text(priorityLabel(p)) }, onClick = { prioMenu = false; vm.setPriority(p) }) }
                }
            }
            ControlChip(stringResource(R.string.td_start, dayText(t.startDate) ?: "—"), Icons.Filled.CalendarMonth, c.mutedFg) { picking = "start" }
            ControlChip(dayText(t.dueDate) ?: stringResource(R.string.td_no_due), Icons.Filled.CalendarMonth, c.mutedFg) { picking = "due" }
        }
    }
    picking?.let { which ->
        val current = dueDate(if (which == "due") t.dueDate else t.startDate)
        val st = rememberDatePickerState(initialSelectedDateMillis = (current ?: LocalDate.now()).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    st.selectedDateMillis?.let { ms ->
                        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        if (which == "due") vm.setDue(d) else vm.setStart(d)
                    }
                    picking = null
                }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = {
                TextButton(onClick = { if (which == "due") vm.setDue(null) else vm.setStart(null); picking = null }) { Text(stringResource(R.string.td_clear_date)) }
            },
        ) { DatePicker(st, title = { Text(stringResource(if (which == "due") R.string.td_due_date else R.string.td_start_date), Modifier.padding(start = 24.dp, top = 16.dp)) }) }
    }
}

@Composable
private fun QuestBanner(t: TaskDetail, isBoD: Boolean, vm: TaskDetailViewModel) {
    if (t.quests.isEmpty() && !isBoD) return
    val c = Nx.colors
    var composing by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().background(c.violet.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
            .border(1.dp, c.violet.copy(alpha = 0.25f), RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        t.quests.forEach { q ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.EmojiEvents, null, tint = c.violetText, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(q.title ?: stringResource(R.string.td_quest), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1)
                    Text(if ((q.total ?: 0) > 0) stringResource(R.string.td_quest_progress, q.done ?: 0, q.total ?: 0) else stringResource(R.string.td_quest_finish),
                        fontSize = 11.sp, color = c.mutedFg)
                }
                Pill("+${q.xpReward ?: 0} XP", c.violetText)
            }
        }
        if (isBoD) {
            if (t.quests.isNotEmpty()) HorizontalDivider(color = c.violet.copy(alpha = 0.2f))
            Row(Modifier.clickable { composing = true }, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.EmojiEvents, null, tint = c.violetText, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(if (t.quests.isEmpty()) R.string.td_make_quest else R.string.td_another_quest),
                    fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.violetText)
            }
        }
    }
    if (composing) {
        var title by rememberSaveable { mutableStateOf(t.title) }
        var xp by rememberSaveable { mutableStateOf("10") }
        val xpValue = xp.toIntOrNull()
        AlertDialog(
            onDismissRequest = { composing = false },
            title = { Text(stringResource(R.string.td_make_quest)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.td_quest_title)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(xp, { xp = it.filter(Char::isDigit).take(2) }, label = { Text("XP") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                    Text(stringResource(R.string.td_quest_help), fontSize = 12.sp, color = c.mutedFg)
                }
            },
            confirmButton = {
                TextButton(enabled = title.isNotBlank() && xpValue != null && xpValue in 1..50,
                    onClick = { vm.createQuest(title, xpValue ?: 0) { composing = false } }) { Text(stringResource(R.string.td_create_quest)) }
            },
            dismissButton = { TextButton(onClick = { composing = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun MetaCard(t: TaskDetail, s: TaskDetailState, vm: TaskDetailViewModel, onOpenProject: (String) -> Unit) {
    val c = Nx.colors
    var picking by remember { mutableStateOf(false) }
    Card {
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column(Modifier.weight(1f).clickable { picking = true }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Caption(stringResource(R.string.td_assigned) + " ✎")
                val people = t.assignees.mapNotNull { it.user }
                if (people.isEmpty()) Text(stringResource(R.string.td_unassigned), fontSize = 13.sp, color = c.violetText)
                else Row(verticalAlignment = Alignment.CenterVertically) {
                    people.take(3).forEach { Avatar(it.name, it.avatar, 22.dp); Spacer(Modifier.width(4.dp)) }
                    Text(people.joinToString(", ") { it.name.orEmpty() }, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            t.taskList?.project?.let { p ->
                Column(Modifier.weight(1f).clickable { p.id?.let(onOpenProject) }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Caption(stringResource(R.string.td_project))
                    Text(listOfNotNull(p.name, t.taskList.name).joinToString(" · "), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    if (picking) {
        var chosen by remember { mutableStateOf(t.assignees.mapNotNull { it.user?.id ?: it.userId }.toSet()) }
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(stringResource(R.string.td_assigned_title)) },
            text = {
                if (s.members.isEmpty()) Muted(stringResource(R.string.td_no_members))
                else LazyColumn(Modifier.heightIn(max = 380.dp)) {
                    items(s.members, key = { it.userId ?: it.user?.id ?: "" }) { m ->
                        val id = m.userId ?: m.user?.id ?: return@items
                        Row(Modifier.fillMaxWidth().clickable { chosen = if (id in chosen) chosen - id else chosen + id }.padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.user?.name, m.user?.avatar, 28.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(m.user?.name ?: "—", Modifier.weight(1f), fontSize = 14.sp, color = c.foreground)
                            Checkbox(id in chosen, { chosen = if (id in chosen) chosen - id else chosen + id })
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { picking = false; vm.setAssignees(chosen) }, enabled = s.members.isNotEmpty()) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun DescriptionCard(t: TaskDetail, vm: TaskDetailViewModel) {
    val c = Nx.colors
    val original = t.descriptionText
    var draft by rememberSaveable(t.id, original) { mutableStateOf(original) }
    Card {
        Caption(stringResource(R.string.td_description))
        TextField(
            draft, { draft = it }, placeholder = { Text(stringResource(R.string.td_add_description)) },
            textStyle = TextStyle(fontSize = 14.sp, color = c.foreground), minLines = 2, maxLines = 12,
            colors = TextFieldDefaults.colors(focusedContainerColor = c.muted.copy(alpha = 0.4f), unfocusedContainerColor = c.muted.copy(alpha = 0.4f),
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
            shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth(),
        )
        if (draft != original) Row {
            TextButton(onClick = { draft = original }) { Text(stringResource(R.string.cancel)) }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { vm.setDescription(draft) {} }) { Text(stringResource(R.string.save), fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun SubtasksCard(t: TaskDetail, vm: TaskDetailViewModel, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    var draft by rememberSaveable(t.id) { mutableStateOf("") }
    val done = t.subtasks.count { it.isDone }
    Card {
        CardHeader(stringResource(R.string.td_subtasks), trailing = {
            if (t.subtasks.isNotEmpty()) Text("$done/${t.subtasks.size}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
        })
        if (t.subtasks.isNotEmpty()) LinearProgressIndicator(progress = { done.toFloat() / t.subtasks.size }, color = c.success, modifier = Modifier.fillMaxWidth())
        if (t.subtasks.isEmpty()) Muted(stringResource(R.string.td_no_subtasks))
        t.subtasks.forEach { sub ->
            Row(Modifier.fillMaxWidth().clickable { onOpenTask(sub.id) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.toggleSubtask(sub) }, modifier = Modifier.size(28.dp)) {
                    Icon(if (sub.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, stringResource(R.string.task_toggle_done),
                        tint = if (sub.isDone) c.success else c.mutedFg)
                }
                Spacer(Modifier.width(8.dp))
                Text(sub.title, fontSize = 14.sp, color = if (sub.isDone) c.mutedFg else c.foreground, modifier = Modifier.weight(1f),
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = if (sub.isDone) TextStyle(textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough) else TextStyle.Default)
                sub.assignees.firstOrNull()?.user?.let { Avatar(it.name, it.avatar, 20.dp) }
            }
        }
        if (t.projectId != null) OutlinedTextField(
            draft, { draft = it.replace("\n", "") }, singleLine = true, placeholder = { Text(stringResource(R.string.td_add_subtask)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (draft.isNotBlank()) vm.addSubtask(draft) { draft = "" } }),
            trailingIcon = { if (draft.isNotBlank()) IconButton(onClick = { vm.addSubtask(draft) { draft = "" } }) { Icon(Icons.Filled.Add, stringResource(R.string.add)) } },
            shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun FilesCard(s: TaskDetailState, vm: TaskDetailViewModel) {
    val c = Nx.colors
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Attachment?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) cameraUri?.let { vm.upload(Uri.parse(it)) } }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::upload) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::upload) }
    Card {
        CardHeader(stringResource(R.string.td_files), Icons.Filled.AttachFile, trailing = {
            Box {
                IconButton(onClick = { menu = true }, enabled = s.upload == null, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Filled.Add, stringResource(R.string.td_upload), tint = c.violetText)
                }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.camera)) }, onClick = {
                        menu = false
                        val f = File(File(context.cacheDir, "evidence").apply { mkdirs() }, "task-${System.currentTimeMillis()}.jpg")
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
                        cameraUri = uri.toString()
                        runCatching { camera.launch(uri) }
                    })
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, onClick = {
                        menu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                    })
                    DropdownMenuItem(text = { Text(stringResource(R.string.files)) }, onClick = { menu = false; files.launch(arrayOf("*/*")) })
                }
            }
        })
        s.upload?.let { u ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.td_uploading, u.name), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                LinearProgressIndicator(progress = { if (u.total > 0) u.done.toFloat() / u.total else 0f }, modifier = Modifier.fillMaxWidth())
            }
        }
        if (s.attachments.isEmpty() && s.upload == null) Muted(stringResource(R.string.td_no_files))
        s.attachments.forEach { a ->
            var rowMenu by remember { mutableStateOf(false) }
            Row(Modifier.fillMaxWidth().clickable { vm.open(a, share = false) }, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(40.dp).background(c.muted, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    if (a.isImage && a.url != null) RemoteImage(a.url, Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)), maxPx = 160) {
                        Icon(Icons.Filled.Description, null, tint = c.mutedFg)
                    } else Icon(Icons.Filled.Description, null, tint = c.mutedFg)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOf(sizeText(a.size), whenText(a.createdAt)).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                }
                if (a.kind == "PROOF") { Pill(stringResource(R.string.td_proof), c.success); Spacer(Modifier.width(4.dp)) }
                if (s.opening == a.id) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Box {
                    IconButton(onClick = { rowMenu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                    DropdownMenu(rowMenu, { rowMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.td_open_file)) }, onClick = { rowMenu = false; vm.open(a, share = false) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.td_save_share)) }, onClick = { rowMenu = false; vm.open(a, share = true) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.delete), color = c.danger) }, onClick = { rowMenu = false; deleting = a })
                    }
                }
            }
        }
    }
    deleting?.let { a ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.td_delete_file_q)) }, text = { Text(a.label) },
            confirmButton = { TextButton(onClick = { deleting = null; vm.deleteAttachment(a) }) { Text(stringResource(R.string.delete), color = c.danger) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun DependenciesCard(s: TaskDetailState, vm: TaskDetailViewModel, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    var picking by remember { mutableStateOf(false) }
    val blockedBy = s.deps.dependencies.mapNotNull { d -> d.dependsOnTask?.let { it to d.id } }
    val blocking = s.deps.dependedOnBy.mapNotNull { d -> d.task?.let { it to d.id } }
    Card {
        CardHeader(stringResource(R.string.td_dependencies), trailing = {
            if (s.task?.projectId != null) IconButton(onClick = { vm.loadProjectTasks(); picking = true }, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Filled.Add, stringResource(R.string.td_add_dependency), tint = c.violetText)
            }
        })
        when {
            !s.depsLoaded -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            blockedBy.isEmpty() && blocking.isEmpty() -> Muted(stringResource(R.string.td_no_dependencies))
            else -> {
                if (blockedBy.isNotEmpty()) DepGroup(stringResource(R.string.td_blocked_by), blockedBy, onOpenTask) { vm.removeDependency(it) }
                if (blocking.isNotEmpty()) DepGroup(stringResource(R.string.td_blocking), blocking, onOpenTask, null)
            }
        }
    }
    if (picking) {
        var q by rememberSaveable { mutableStateOf("") }
        val existing = blockedBy.map { it.first.id }.toSet()
        val tk = BoardLogic.tokens(q)
        val options = s.projectTasks.filter { it.id != s.task?.id && it.id !in existing && tk.all { w -> w in it.title.lowercase() } }
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(stringResource(R.string.td_add_dependency)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                        placeholder = { Text(stringResource(R.string.td_search_tasks)) }, modifier = Modifier.fillMaxWidth())
                    if (s.projectTasks.isEmpty()) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else if (options.isEmpty()) Muted(stringResource(R.string.td_no_other_tasks))
                    else LazyColumn(Modifier.heightIn(max = 340.dp)) {
                        items(options, key = { it.id }) { o ->
                            Row(Modifier.fillMaxWidth().clickable { picking = false; vm.addDependency(o.id) }.padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(8.dp).background(if (o.isDone) c.success else c.mutedFg.copy(alpha = 0.4f), CircleShape))
                                Spacer(Modifier.width(10.dp))
                                Text(o.title, fontSize = 14.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun DepGroup(label: String, rows: List<Pair<DepTask, String>>, onOpenTask: (String) -> Unit, onRemove: ((String) -> Unit)?) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Caption(label)
        rows.forEach { (ref, depId) ->
            Row(Modifier.fillMaxWidth().clickable { onOpenTask(ref.id) }, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(if (ref.status.equals("DONE", true)) c.success else c.mutedFg.copy(alpha = 0.4f), CircleShape))
                Spacer(Modifier.width(10.dp))
                Text(ref.title, fontSize = 13.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(vertical = 6.dp))
                onRemove?.let { IconButton(onClick = { it(depId) }, modifier = Modifier.size(28.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.mutedFg) } }
            }
        }
    }
}

@Composable
private fun TimeCard(s: TaskDetailState, vm: TaskDetailViewModel) {
    val c = Nx.colors
    var minutes by rememberSaveable { mutableStateOf("") }
    val total = s.time.sumOf { it.duration ?: 0 }
    Card {
        CardHeader(if (total > 0) stringResource(R.string.td_time_total, minutesText(total)) else stringResource(R.string.td_time))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(5) }, singleLine = true, placeholder = { Text(stringResource(R.string.td_minutes)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), shape = RoundedCornerShape(10.dp), modifier = Modifier.width(120.dp))
            Spacer(Modifier.width(8.dp))
            val m = minutes.toIntOrNull() ?: 0
            TextButton(onClick = { vm.logTime(m) { minutes = "" } }, enabled = m in 1..44640 && !s.busy) {
                Text(stringResource(R.string.td_log_time), fontWeight = FontWeight.Bold)
            }
        }
        s.time.take(6).forEach { e ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(minutesText(e.duration ?: 0), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                Spacer(Modifier.width(8.dp))
                Text(e.description ?: e.user?.name.orEmpty(), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(whenText(e.startTime), fontSize = 11.sp, color = c.mutedFg)
            }
        }
    }
}

@Composable
private fun CommentsCard(t: TaskDetail, vm: TaskDetailViewModel) {
    val c = Nx.colors
    var draft by rememberSaveable(t.id) { mutableStateOf("") }
    Card {
        CardHeader(stringResource(R.string.td_comments), trailing = {
            if (t.comments.isNotEmpty()) Text("${t.comments.size}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
        })
        if (t.comments.isEmpty()) Muted(stringResource(R.string.td_no_comments))
        t.comments.forEach { cm ->
            Row(verticalAlignment = Alignment.Top) {
                Avatar(cm.user?.name, cm.user?.avatar, 28.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(cm.user?.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                        Spacer(Modifier.width(6.dp))
                        Text(whenText(cm.createdAt), fontSize = 11.sp, color = c.mutedFg)
                    }
                    Text(cm.content, fontSize = 14.sp, color = c.foreground)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(draft, { draft = it }, placeholder = { Text(stringResource(R.string.td_write_comment)) }, maxLines = 5,
                shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f))
            IconButton(onClick = { vm.comment(draft) { draft = "" } }, enabled = draft.isNotBlank()) {
                Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = if (draft.isNotBlank()) c.violetText else c.mutedFg)
            }
        }
    }
}

@Composable
private fun ActivityCard(t: TaskDetail) {
    if (t.activityLogs.isEmpty()) return
    val c = Nx.colors
    Card {
        CardHeader(stringResource(R.string.td_activity))
        t.activityLogs.take(12).forEach { a ->
            Row(verticalAlignment = Alignment.Top) {
                Text(a.user?.name ?: "—", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                Spacer(Modifier.width(6.dp))
                Text(activityText(a), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(6.dp))
                Text(whenText(a.createdAt), fontSize = 11.sp, color = c.mutedFg.copy(alpha = 0.8f))
            }
        }
    }
}

/** "status_changed" → "Status changed — DONE". */
internal fun activityText(a: ActivityLog): String {
    val action = a.action.orEmpty().lowercase().replace('_', ' ').replaceFirstChar { it.titlecase(Locale.getDefault()) }
    val detail = when (val d = a.details) {
        null -> null
        is kotlinx.serialization.json.JsonPrimitive -> valueText(d)
        is kotlinx.serialization.json.JsonObject -> d.values.mapNotNull { v -> (v as? kotlinx.serialization.json.JsonPrimitive)?.let(::valueText) }
            .filter { it.isNotBlank() }.joinToString(" → ").ifBlank { null }
        else -> blockText(d).ifBlank { null }
    }
    return if (detail.isNullOrBlank()) action else "$action — ${detail.take(140)}"
}
