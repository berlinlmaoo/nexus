package id.znetworks.nexus.feature.meetings

import id.znetworks.nexus.ui.components.NxCheckbox

import id.znetworks.nexus.ui.components.NxTextField

import android.app.DatePickerDialog
import android.media.MediaPlayer
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.ConfigBody
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.*
import id.znetworks.nexus.feature.gideon.GPicker
import id.znetworks.nexus.feature.gideon.GProperty
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.*
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*
import java.time.LocalDate

@OptIn(ExperimentalLayoutApi::class)
@Composable fun MeetingScreen(id: String, onBack: () -> Unit, onAllMeetings: () -> Unit = onBack, vm: MeetingEditor = viewModel()) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val state by vm.state.collectAsStateWithLifecycle()
    val m = state.meeting
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var confirmation by remember { mutableStateOf<String?>(null) }
    var projects by remember { mutableStateOf<List<MeetingProject>>(emptyList()) }
    var transcript by rememberSaveable(id) { mutableStateOf(false) }
    var find by rememberSaveable(id) { mutableStateOf("") }
    var seek by remember { mutableStateOf<Double?>(null) }
    val playback = rememberMeetingPlayback(m, seek) { seek = null }
    LaunchedEffect(id) { vm.open(id); runCatching { vm.api.projects() }.getOrNull()?.let { projects = it } }
    LaunchedEffect(state.notice) { state.notice?.let { android.widget.Toast.makeText(context, context.getString(it), android.widget.Toast.LENGTH_LONG).show(); vm.noticeSeen() } }
    LaunchedEffect(state.deleted) { if (state.deleted) onBack() }
    RealtimeRoom(m?.projectId?.let { "project:$it" })
    LiveRefresh(id, 20_000, 15_000, { event ->
        if (event.name != "meeting-changed") false else event.raw?.let {
            runCatching { NexusJson.decodeFromString(MeetingChanged.serializer(), it) }.getOrNull()?.let(vm::reading)
        } ?: false
    }) { vm.refresh() }
    val lang = ConfigBody.lang(androidx.compose.ui.platform.LocalConfiguration.current.locales[0])
    fun change(field: String, value: JsonElement) = vm.change(buildJsonObject { put(field, value) })
    fun mom(value: MeetingMom) = change("mom", NexusJson.encodeToJsonElement(MeetingMom.serializer(), value))
    fun proposals(value: List<MeetingProposal>) = change("proposals", NexusJson.encodeToJsonElement(ListSerializer(MeetingProposal.serializer()), value))
    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        PageHeader(stringResource(R.string.meet_title), onBack = onBack, onTitleClick = { container.router.open(Target.Meetings(m?.projectId)) }, leading = { MeetingBeta() }) {
            Box {
                HeaderIconButton(Icons.Outlined.MoreHoriz, stringResource(R.string.more), { menu = true })
                DropdownMenu(menu, { menu = false }) {
                    if (m?.status == "READY" && m.can.retry) DropdownMenuItem(text = { Text(stringResource(R.string.meet_rewrite)) }, onClick = { menu = false; confirmation = "rewrite" })
                    if (m?.can?.delete == true) DropdownMenuItem(text = { Text(stringResource(R.string.meet_delete), color = c.dangerText) }, onClick = { menu = false; confirmation = "delete" })
                }
            }
        }
        if (m == null) {
            when {
                state.missing -> EmptyState(Icons.Outlined.Mic, stringResource(R.string.qa_meeting_deleted), stringResource(R.string.qa_meeting_deleted_body), stringResource(R.string.qa_all_meetings), onAllMeetings)
                state.loading -> CircularProgressIndicator(Modifier.padding(24.dp))
                state.terminal -> EmptyState(Icons.Outlined.Mic, stringResource(R.string.meet_load_failed), "", stringResource(R.string.qa_all_meetings), onAllMeetings)
                else -> EmptyState(Icons.Outlined.Mic, stringResource(R.string.meet_load_failed), "", stringResource(R.string.gx_try_again), { scope.launch { vm.refresh() } })
            }
            return@Column
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                if (m.can.edit) BasicTextField(m.title, { change("title", JsonPrimitive(it)) }, textStyle = TextStyle(color = c.foreground, fontSize = 26.sp, fontWeight = FontWeight.SemiBold), modifier = Modifier.fillMaxWidth(), enabled = !state.busy)
                else Text(m.title, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                Text(stringResource(if (state.saving || state.dirty) R.string.meet_saving else R.string.meet_saved_draft), color = c.mutedFg, fontSize = 11.sp)
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    MeetingProperty(stringResource(R.string.meet_status)) { Text(meetingStatus(m.status), color = when (m.status) { "FAILED" -> c.dangerText; "READY", "APPLIED" -> c.success; else -> c.mutedFg }) }
                    MeetingProperty(stringResource(R.string.meet_project)) {
                        if (m.can.edit && m.createdBy?.id == container.sessionStore.current?.userId && m.status != "APPLIED") GPicker(stringResource(R.string.meet_choose_project), projects.firstOrNull { it.id == m.projectId }?.name ?: m.project?.name,
                            listOf("" to stringResource(R.string.meet_none)) + projects.map { it.id to it.name }, !state.busy && !state.saving) { p ->
                            vm.change(buildJsonObject {
                                put("projectId", p.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
                                if (m.status == "READY") put("proposals", NexusJson.encodeToJsonElement(ListSerializer(MeetingProposal.serializer()), m.proposals.map { it.copy(assigneeIds = emptyList()) }))
                            })
                        } else Text(m.project?.name ?: "—", color = c.foreground)
                    }
                    MeetingProperty(stringResource(R.string.meet_date)) { Text(meetingDateTime(m.recordedAt ?: m.createdAt), fontSize = 12.sp, color = c.foreground) }
                    MeetingProperty(stringResource(R.string.meet_duration)) { Text(m.durationSec?.let(MeetingRules::timestamp) ?: "—", color = c.foreground) }
                    MeetingProperty(stringResource(R.string.meet_language)) {
                        if (m.can.edit && m.status in setOf("UPLOADING", "QUEUED")) GPicker(stringResource(R.string.meet_language), m.language, listOf("auto" to stringResource(R.string.meet_auto), "id" to stringResource(R.string.meet_indonesian), "en" to stringResource(R.string.meet_english))) { change("language", JsonPrimitive(it)) }
                        else Text(when (m.detectedLanguage ?: m.language) { "id" -> stringResource(R.string.meet_indonesian); "en" -> stringResource(R.string.meet_english); "auto" -> stringResource(R.string.meet_auto); else -> m.detectedLanguage ?: m.language }, color = c.foreground)
                    }
                    MeetingProperty(stringResource(R.string.meet_recorded_by)) { Text(m.createdBy?.name ?: "—", color = c.foreground) }
                    MeetingPlayer(m, playback)
                }
            }
            state.error?.let { error -> item { Text(stringResource(error), color = c.dangerText); if (state.dirty) TextButton(onClick = { scope.launch { vm.save() } }) { Text(stringResource(R.string.gx_try_again)) } } }
            if (m.working) item {
                MeetingSection(meetingStatus(m.status), card = true) {
                    val stages = listOf("UPLOADING", "TRANSCRIBING", "SUMMARIZING", "READY")
                    val current = when (m.status) { "QUEUED" -> 1; "APPLYING" -> 3; else -> stages.indexOf(m.status).coerceAtLeast(0) }
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) { stages.forEachIndexed { i, stage -> Text((if (i < current) "✓ " else "${i + 1}. ") + meetingStatus(stage), color = if (i <= current) c.foreground else c.mutedFg, fontSize = 11.sp) } }
                    LinearProgressIndicator(progress = { m.progress.toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                    Text(stringResource(when { m.status == "TRANSCRIBING" && m.transcribeStats?.stage == "speakers" -> R.string.meet_telling_voices; m.status == "TRANSCRIBING" -> R.string.meet_transcribing_hint; m.status == "SUMMARIZING" -> R.string.meet_summarizing_hint; else -> R.string.meet_upload_hint }), color = c.mutedFg, fontSize = 12.sp)
                    MeetingQueueBlock(m)
                    if (m.status == "UPLOADING") NxButton(stringResource(R.string.meet_resume_upload), { if (!MeetingFiles.resume(context, container.sessionStore.current!!.userId, m)) UiNotice.show(context.getString(R.string.meet_missing_local)) })
                }
            }
            if (m.status == "FAILED") item { MeetingSection(stringResource(R.string.meet_failed), card = true) {
                Text(stringResource(meetingProblem(m.errorCode)), color = c.dangerText)
                if (MeetingRules.retryable(m)) NxButton(stringResource(R.string.gx_try_again), { vm.action("retry", lang) }, enabled = !state.busy)
            } }
            if (m.status == "APPLIED") item { Column(Modifier.fillMaxWidth().background(c.success.copy(alpha = .08f), RoundedCornerShape(12.dp)).padding(12.dp)) {
                Text(pluralStringResource(R.plurals.meet_saved_tasks, m.taskCount, m.taskCount), color = c.success, fontWeight = FontWeight.SemiBold)
                m.doc?.let { doc -> TextButton(onClick = { container.router.open(Target.Docs(doc.id)) }) { Text(stringResource(R.string.meet_open_minutes)) } }
            } }
            if (m.status in setOf("READY", "APPLIED")) {
                val editable = m.editable && !state.busy
                val minutes = m.mom ?: MeetingMom()
                item { MeetingSection(stringResource(R.string.meet_overview)) { MeetingText(m.overview.orEmpty(), editable) { change("overview", JsonPrimitive(it)) } } }
                item { MeetingSection(stringResource(R.string.meet_mom)) {
                    Text(stringResource(R.string.meet_attendees), fontWeight = FontWeight.SemiBold)
                    if (MeetingRules.voices(m).isNotEmpty()) Text(stringResource(R.string.meet_attendee_voices_hint), color = c.mutedFg, fontSize = 12.sp)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) { minutes.attendees.forEachIndexed { i, attendee ->
                        if (editable) NxButton("$attendee ×", { mom(minutes.copy(attendees = minutes.attendees.filterIndexed { j, _ -> i != j })) }, compact = true)
                        else Text(attendee, modifier = Modifier.padding(6.dp), color = c.foreground)
                    } }
                    if (editable) AttendeeAdder(m.projectMembers.map { it.id to it.name }) { name -> if (name.isNotBlank() && name !in minutes.attendees) mom(minutes.copy(attendees = minutes.attendees + name)) }
                    Text(stringResource(R.string.meet_topics), fontWeight = FontWeight.SemiBold)
                    minutes.topics.forEachIndexed { i, topic ->
                        MeetingText(topic.title, editable, stringResource(R.string.meet_topic_title)) { v -> mom(minutes.copy(topics = minutes.topics.mapIndexed { j, t -> if (i == j) t.copy(title = v) else t })) }
                        MeetingText(topic.points.joinToString("\n"), editable, stringResource(R.string.meet_points)) { v -> mom(minutes.copy(topics = minutes.topics.mapIndexed { j, t -> if (i == j) t.copy(points = v.lines()) else t })) }
                    }
                    if (editable) TextButton(onClick = { mom(minutes.copy(topics = minutes.topics + MeetingTopic())) }) { Text(stringResource(R.string.meet_add)) }
                    Text(stringResource(R.string.meet_decisions), fontWeight = FontWeight.SemiBold)
                    MeetingText(minutes.decisions.joinToString("\n"), editable) { mom(minutes.copy(decisions = it.lines())) }
                    Text(stringResource(R.string.meet_questions), fontWeight = FontWeight.SemiBold)
                    MeetingText(minutes.openQuestions.joinToString("\n"), editable) { mom(minutes.copy(openQuestions = it.lines())) }
                    Text(stringResource(R.string.meet_actions), fontWeight = FontWeight.SemiBold)
                    minutes.actionItems.forEachIndexed { i, action ->
                        MeetingText(action.text, editable) { v -> mom(minutes.copy(actionItems = minutes.actionItems.mapIndexed { j, a -> if (j == i) a.copy(text = v) else a })) }
                        if (editable) {
                            MeetingText(action.owner.orEmpty(), true, stringResource(R.string.meet_owner)) { v -> mom(minutes.copy(actionItems = minutes.actionItems.mapIndexed { j, a -> if (j == i) a.copy(owner = v) else a })) }
                            MeetingDate(action.due) { date -> mom(minutes.copy(actionItems = minutes.actionItems.mapIndexed { j, a -> if (j == i) a.copy(due = date) else a })) }
                        } else Text(listOfNotNull(action.owner, action.due).joinToString(" · "), color = c.mutedFg, fontSize = 12.sp)
                    }
                    if (editable) TextButton(onClick = { mom(minutes.copy(actionItems = minutes.actionItems + MeetingAction())) }) { Text(stringResource(R.string.meet_add)) }
                } }
                if (m.status == "READY") {
                    item { Text(stringResource(R.string.meet_tasks), fontWeight = FontWeight.SemiBold); Text(stringResource(R.string.meet_selected, m.proposals.count { it.include }.toString(), m.proposals.size.toString()), fontSize = 12.sp, color = c.mutedFg) }
                    items(m.proposals, key = { it.key }) { task -> MeetingSection("", card = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            NxCheckbox(task.include, { checked -> proposals(m.proposals.map { if (it.key == task.key) it.copy(include = checked) else it }) }, enabled = editable)
                            Text(stringResource(R.string.meet_task_title), color = c.mutedFg, fontSize = 12.sp)
                            Spacer(Modifier.weight(1f))
                            if (editable) IconButton(onClick = { proposals(m.proposals.filterNot { it.key == task.key }) }) {
                                Icon(Icons.Outlined.DeleteOutline, stringResource(R.string.meet_remove), tint = c.mutedFg, modifier = Modifier.size(18.dp))
                            }
                        }
                        fun update(value: MeetingProposal) = proposals(m.proposals.map { if (it.key == task.key) value else it })
                        MeetingText(task.title, editable) { update(task.copy(title = it)) }
                        if (editable) {
                            MeetingOwners(m.projectMembers, task.assigneeIds) { update(task.copy(assigneeIds = it)) }
                            MeetingDate(task.dueDate) { update(task.copy(dueDate = it)) }
                        } else Text(task.assigneeIds.mapNotNull { id -> m.projectMembers.firstOrNull { it.id == id }?.name }.joinToString(", "), color = c.mutedFg)
                        MeetingText(task.description, editable, stringResource(R.string.meet_description)) { update(task.copy(description = it)) }
                    } }
                    if (editable) item { TextButton(onClick = { proposals(m.proposals + MeetingProposal(java.util.UUID.randomUUID().toString())) }) { Text(stringResource(R.string.meet_add_task)) } }
                } else items(m.tasks, key = { it.id }) { task -> TextButton(onClick = { container.router.open(Target.Task(task.id)) }) { Text(task.title) } }
            }
            if (MeetingRules.voices(m).isNotEmpty()) item { MeetingSpeakers(m, state.busy, { change("speakers", it) }, { seek = it }) }
            item {
                TextButton(onClick = { transcript = !transcript }) { Text((if (transcript) "▾ " else "▸ ") + stringResource(R.string.meet_transcript)) }
                if (transcript) {
                    Text(stringResource(R.string.meet_automatic), color = c.mutedFg, fontSize = 12.sp)
                    NxTextField(find, { find = it }, placeholder = { Text(stringResource(R.string.meet_find)) }, modifier = Modifier.fillMaxWidth())
                }
            }
            if (transcript) items(m.transcript.withIndex().filter { it.value.text.contains(find, true) }, key = { "segment:${it.index}" }) { (_, segment) ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { seek = segment.start }, enabled = m.audio.available) { Text(MeetingRules.timestamp(segment.start)) }
                    SelectionContainer(Modifier.weight(1f)) { Column {
                        segment.speaker?.let { label -> Text(((m.speakers ?: m.speakersMap.orEmpty())[label]?.name?.takeIf { it.isNotBlank() } ?: voiceLabel(label)) + ":", color = voiceColor(label), fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                        Text(segment.text, color = c.foreground, fontSize = 13.sp)
                    } }
                }
            }
        }
        if (m.status == "READY" && m.can.apply) Column(Modifier.fillMaxWidth().background(c.card).padding(12.dp)) {
            if (m.projectId == null) Text(stringResource(R.string.meet_need_project), color = c.warningFg, fontSize = 12.sp)
            if (m.proposals.any { it.include && it.title.isBlank() }) Text(stringResource(R.string.meet_empty_title), color = c.warningFg, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val count = m.proposals.count { it.include }
                Text(pluralStringResource(R.plurals.meet_apply_tasks, count, count), color = c.mutedFg, fontSize = 12.sp, modifier = Modifier.weight(1f))
                Button(onClick = { confirmation = "apply" }, enabled = MeetingRules.canApply(m) && !state.busy && !state.saving,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = c.violetText,
                        contentColor = if (Nx.isDark) c.background else androidx.compose.ui.graphics.Color.White)) {
                    Text(stringResource(R.string.meet_apply))
                }
            }
        }
    }
    confirmation?.let { action -> AlertDialog(onDismissRequest = { confirmation = null }, title = { Text(stringResource(when (action) { "delete" -> R.string.meet_delete; "rewrite" -> R.string.meet_rewrite; else -> R.string.meet_apply })) }, text = {
        val count = m?.proposals?.count { it.include } ?: 0
        Text(if (action == "apply") pluralStringResource(R.plurals.meet_apply_tasks, count, count) else stringResource(if (action == "delete") R.string.meet_delete_confirm else R.string.meet_rewrite_confirm))
    }, confirmButton = { TextButton(onClick = { confirmation = null; vm.action(action, lang) }) { Text(stringResource(when (action) { "delete" -> R.string.meet_delete; "rewrite" -> R.string.meet_rewrite; else -> R.string.meet_apply }), color = if (action == "delete") c.dangerText else c.foreground) } }, dismissButton = { TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.cancel)) } }) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MeetingOwners(members: List<id.znetworks.nexus.feature.gideon.GTaskMember>, selected: List<String>, change: (List<String>) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    fun pick() { query = ""; open = true }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        selected.forEach { uid ->
            val member = members.firstOrNull { it.id == uid }
            InputChip(selected = false, onClick = ::pick,
                label = { Text(member?.name ?: "—") },
                avatar = { Avatar(member?.name, member?.avatar, 20.dp, userId = uid) },
                trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) },
                shape = RoundedCornerShape(12.dp), border = null,
                colors = InputChipDefaults.inputChipColors(containerColor = c.muted, labelColor = c.foreground))
        }
        if (selected.isEmpty() || members.any { it.id !in selected }) TextButton(onClick = ::pick,
            shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.textButtonColors(containerColor = c.muted, contentColor = c.foreground)) {
            Text("+ " + stringResource(R.string.meet_owner))
        }
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text(stringResource(R.string.meet_owner)) }, text = {
        Column {
            NxTextField(query, { query = it }, placeholder = { Text(stringResource(R.string.gt_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState())) {
                members.filter { it.name.contains(query, true) }.forEach { member ->
                    Row(Modifier.fillMaxWidth().clickable {
                        change(if (member.id in selected) selected - member.id else selected + member.id); open = false
                    }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Avatar(member.name, member.avatar, 28.dp, userId = member.id)
                        Text(member.name, Modifier.weight(1f), color = c.foreground)
                        NxCheckbox(member.id in selected, null)
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable internal fun MeetingSection(title: String, card: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().then(if (card) Modifier.background(Nx.colors.muted.copy(alpha = .45f), RoundedCornerShape(12.dp)).padding(12.dp) else Modifier.padding(vertical = 8.dp)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (title.isNotEmpty()) Text(title, color = Nx.colors.foreground, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
        content()
    }
}
@Composable internal fun MeetingProperty(label: String, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, fontSize = 12.sp, color = Nx.colors.mutedFg, modifier = Modifier.width(90.dp))
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, content = content)
    }
}
@Composable internal fun MeetingText(value: String, editable: Boolean, label: String? = null, change: (String) -> Unit) {
    if (editable) Column {
        label?.let { Text(it, color = Nx.colors.mutedFg, fontSize = 11.sp) }
        BasicTextField(value, change, textStyle = TextStyle(color = Nx.colors.foreground, fontSize = 14.sp, lineHeight = 22.sp), modifier = Modifier.fillMaxWidth().heightIn(min = 32.dp), decorationBox = { inner -> if (value.isEmpty()) Text("—", color = Nx.colors.mutedFg); inner() })
    }
    else SelectionContainer { Text(value.ifEmpty { "—" }, color = Nx.colors.foreground, fontSize = 14.sp) }
}
@Composable private fun AttendeeAdder(members: List<Pair<String, String>>, onAdd: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        NxTextField(name, { name = it }, placeholder = { Text(stringResource(R.string.meet_add_attendee)) }, modifier = Modifier.weight(1f), singleLine = true)
        IconButton(onClick = { onAdd(name.trim()); name = "" }, enabled = name.isNotBlank()) { Icon(Icons.Outlined.Add, stringResource(R.string.meet_add)) }
    }
    GPicker(stringResource(R.string.meet_attendees), null, members) { id -> members.firstOrNull { it.first == id }?.second?.let(onAdd) }
}
@Composable internal fun MeetingDate(value: String?, onChange: (String?) -> Unit) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.meet_due), color = Nx.colors.mutedFg, fontSize = 12.sp)
        TextButton(onClick = {
            val date = value?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: id.znetworks.nexus.core.time.OfficeTime.today()
            DatePickerDialog(context, { _, y, m, d -> onChange(LocalDate.of(y, m + 1, d).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
        }, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.textButtonColors(containerColor = Nx.colors.muted, contentColor = Nx.colors.foreground)) {
            Text(value ?: stringResource(R.string.meet_add_date))
        }
        if (value != null) IconButton(onClick = { onChange(null) }) { Icon(Icons.Outlined.Close, stringResource(R.string.meet_remove)) }
    }
}

private data class MeetingPlayback(val busy: Boolean, val playing: Boolean, val position: Float, val duration: Float?, val problem: Int?, val toggle: () -> Unit, val scrub: (Float) -> Unit)

@Composable private fun rememberMeetingPlayback(meeting: Meeting?, seek: Double?, onSeek: () -> Unit): MeetingPlayback {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    var player by remember(meeting?.id) { mutableStateOf<MediaPlayer?>(null) }
    var busy by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableFloatStateOf(0f) }
    var problem by remember { mutableStateOf<Int?>(null) }
    DisposableEffect(meeting?.id) { onDispose { player?.release(); player = null } }
    fun play(at: Double? = null) {
        if (busy || meeting?.audio?.available != true) return
        val existing = player
        if (existing != null) {
            runCatching { if (at != null) existing.seekTo((at * 1000).toInt()); existing.start(); playing = true }
                .onFailure { existing.release(); player = null; playing = false; problem = R.string.meet_audio_failed }
            return
        }
        busy = true; problem = null
        scope.launch {
            try {
                val file = FileOpener.fetch(context, container.api, "/api/meetings/${meeting.id}/audio", meeting.audio.name.ifBlank { "meeting.m4a" })
                val created = MediaPlayer(); player = created
                created.setDataSource(file.absolutePath)
                created.setOnPreparedListener { mp -> busy = false; at?.let { mp.seekTo((it * 1000).toInt()) }; mp.start(); playing = true }
                created.setOnCompletionListener { playing = false }
                created.setOnErrorListener { mp, _, _ -> problem = R.string.meet_audio_failed; busy = false; playing = false; mp.release(); player = null; true }
                created.prepareAsync()
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) { player?.release(); player = null; problem = if (e is ApiError.Http && e.status == 410) R.string.meet_audio_gone else R.string.meet_audio_failed; busy = false }
        }
    }
    LaunchedEffect(seek) { if (seek != null) { play(seek); onSeek() } }
    LaunchedEffect(meeting?.audio?.available) { if (meeting?.audio?.available != true) { player?.release(); player = null; playing = false } }
    LaunchedEffect(playing) { while (playing) { position = (player?.currentPosition ?: 0) / 1000f; delay(500) } }
    return MeetingPlayback(busy, playing, position, player?.takeIf { !busy }?.let { (it.duration / 1000f).coerceAtLeast(1f) }, problem,
        { if (playing) { player?.pause(); playing = false } else play() }, { position = it; player?.seekTo((it * 1000).toInt()) })
}

@Composable private fun MeetingPlayer(meeting: Meeting, playback: MeetingPlayback) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.meet_file), color = Nx.colors.mutedFg, fontSize = 12.sp)
            IconButton(onClick = playback.toggle, enabled = meeting.audio.available && !playback.busy) { Icon(if (playback.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, stringResource(if (playback.playing) R.string.meet_pause_audio else R.string.meet_play)) }
            Text(MeetingRules.timestamp(playback.position.toDouble()), color = Nx.colors.mutedFg, fontSize = 12.sp)
            if (playback.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        }
        playback.duration?.let { Slider(playback.position, playback.scrub, valueRange = 0f..it) }
        if (!meeting.audio.available) Text(stringResource(if (meeting.audio.deletedAt != null) R.string.meet_audio_gone else R.string.meet_audio_not_uploaded), color = Nx.colors.mutedFg, fontSize = 12.sp)
        playback.problem?.let { Text(stringResource(it), color = Nx.colors.dangerText, fontSize = 12.sp) }
        meeting.audio.deleteAfter?.takeIf { meeting.audio.available }?.let { Text(stringResource(R.string.meet_audio_retention, meetingDateTime(it)), color = Nx.colors.mutedFg, fontSize = 11.sp) }
    }
}
