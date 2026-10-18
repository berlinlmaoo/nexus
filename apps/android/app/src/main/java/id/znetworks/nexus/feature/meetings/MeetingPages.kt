package id.znetworks.nexus.feature.meetings

import android.Manifest
import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.*
import id.znetworks.nexus.feature.gideon.GPicker
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.io.File

@Composable fun MeetingBeta() { Text(stringResource(R.string.meet_beta).uppercase(), color = Nx.colors.violetText, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.background(Nx.colors.accentBg, CircleShape).padding(horizontal = 7.dp, vertical = 3.dp)) }
@Composable fun meetingStatus(status: String) = stringResource(when (status) {
    "UPLOADING" -> R.string.meet_uploading; "QUEUED" -> R.string.meet_queued; "TRANSCRIBING" -> R.string.meet_transcribing; "SUMMARIZING" -> R.string.meet_summarizing
    "READY" -> R.string.meet_ready; "APPLYING" -> R.string.meet_applying; "APPLIED" -> R.string.meet_applied; else -> R.string.meet_failed
})

@Composable internal fun MeetingQueueBlock(meeting: Meeting, compact: Boolean = false) {
    val q = meeting.queue ?: MeetingQueue(etaSec = 85 + (meeting.durationSec ?: 0.0) * 2.8 / 60)
    val minutes = MeetingRules.estimateMinutes(q.etaSec)
    val eta = if (minutes >= 60) stringResource(R.string.meet_eta_hours, (minutes / 60).toString(), (minutes % 60).toString()) else stringResource(R.string.meet_eta, minutes.toString())
    val position = if ((q.position ?: 0) > 1) stringResource(R.string.meet_position, q.position.toString()) else stringResource(R.string.meet_next)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (q.waiting) Text(stringResource(R.string.meet_waiting) + " " + position, color = Nx.colors.mutedFg, fontSize = 12.sp)
        Text(eta + " · " + stringResource(R.string.meet_rough), color = Nx.colors.mutedFg, fontSize = 12.sp)
        if (!compact) Text(stringResource(R.string.meet_leave), color = Nx.colors.mutedFg, fontSize = 12.sp)
    }
}

@Composable fun MeetingsScreen(projectId: String?, onBack: () -> Unit) {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val config by container.remoteConfig.body.collectAsStateWithLifecycle()
    val api = remember { MeetingsApi(container.api) }
    var list by remember(projectId) { mutableStateOf<MeetingList?>(null) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { try { list = api.list(projectId); error = false } catch (_: ApiError) { error = true } }
    LaunchedEffect(projectId) { refresh() }
    RealtimeRoom(projectId?.let { "project:$it" })
    LiveRefresh(projectId, 30_000, 20_000, { it.name == "meeting-changed" }) { refresh() }
    Column(Modifier.fillMaxSize().background(Nx.colors.background)) {
        PageHeader(stringResource(R.string.meet_title), onBack = onBack, leading = { MeetingBeta() }) {
            if (config.meetingNotesEnabled && list?.settings?.enabled != false) HeaderIconButton(Icons.Outlined.Add, stringResource(R.string.meet_new), { container.router.open(Target.NewMeeting(projectId)) }, primary = true)
        }
        when {
            !config.meetingNotesEnabled || list?.settings?.enabled == false -> Text(stringResource(R.string.meet_not_available), modifier = Modifier.padding(24.dp))
            error && list == null -> EmptyState(Icons.Outlined.Mic, stringResource(R.string.meet_load_failed), "", stringResource(R.string.gx_try_again), { scope.launch { refresh() } })
            list == null -> CircularProgressIndicator(Modifier.padding(24.dp))
            list!!.meetings.isEmpty() -> EmptyState(Icons.Outlined.Mic, stringResource(R.string.meet_empty), stringResource(R.string.meet_empty_hint), stringResource(R.string.meet_new), { container.router.open(Target.NewMeeting(projectId)) })
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(list!!.meetings, key = { it.id }) { m ->
                    Column(Modifier.fillMaxWidth().background(Nx.colors.card, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).clickable { container.router.open(Target.Meeting(m.id)) }.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { Text(m.title, color = Nx.colors.foreground, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); MeetingBeta() }
                        Text(meetingStatus(m.status), color = if (m.status == "FAILED") Nx.colors.dangerText else Nx.colors.mutedFg, fontSize = 12.sp)
                        if (m.working) MeetingQueueBlock(m, compact = true)
                        m.project?.name?.let { Text(it, color = Nx.colors.mutedFg, fontSize = 12.sp) }
                    }
                }
            }
        }
    }
}

@Composable fun NewMeetingScreen(projectId: String?, onBack: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val config by container.remoteConfig.body.collectAsStateWithLifecycle()
    val api = remember { MeetingsApi(container.api) }
    val recording by MeetingRecording.state.collectAsStateWithLifecycle()
    val shared by container.meetingSharedAudio.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf(projectId) }
    var language by rememberSaveable { mutableStateOf("auto") }
    var localName by rememberSaveable { mutableStateOf<String?>(null) }
    var fileName by rememberSaveable { mutableStateOf("") }
    var mime by rememberSaveable { mutableStateOf("audio/mp4") }
    var duration by rememberSaveable { mutableStateOf<Double?>(null) }
    var source by rememberSaveable { mutableStateOf("upload") }
    var recordedAt by rememberSaveable { mutableStateOf<String?>(null) }
    var projects by remember { mutableStateOf<List<MeetingProject>>(emptyList()) }
    var projectsFailed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<Int?>(null) }
    var uploadedId by rememberSaveable { mutableStateOf<String?>(null) }
    var uploaded by remember { mutableStateOf<Meeting?>(null) }
    LaunchedEffect(Unit) {
        try { projects = api.projects() } catch (_: ApiError) { projectsFailed = true }
        if (recording.file == null) {
            val prefs = context.getSharedPreferences("meeting-recording", Context.MODE_PRIVATE)
            val name = prefs.getString("file", null)
            if (name != null && File(MeetingFiles.directory(context), name).isFile && prefs.getString("user", null) == container.sessionStore.current?.userId) {
                localName = name; fileName = name; source = "record"; duration = prefs.getFloat("seconds", 0f).toDouble(); recordedAt = prefs.getString("at", null)
            }
        }
    }
    LaunchedEffect(recording.finished, recording.file) {
        if (recording.finished && recording.file != null) { localName = recording.file; fileName = recording.file!!; source = "record"; duration = recording.seconds; recordedAt = recording.recordedAt }
    }
    LaunchedEffect(uploadedId) {
        val id = uploadedId ?: return@LaunchedEffect
        while (isActive) {
            try { uploaded = api.get(id) } catch (_: ApiError) { problem = R.string.meet_load_failed }
            if (uploaded?.status != "UPLOADING" && uploaded != null) break
            delay(2000)
        }
    }
    fun pick(uri: Uri) {
        busy = true; problem = null
        scope.launch {
            var file: File? = null
            try {
                val prepared = withContext(Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: uri.lastPathSegment.orEmpty()
                    if (!MeetingRules.accepts(name)) throw MeetingFileProblem(R.string.meet_unsupported_type)
                    val dest = File(MeetingFiles.directory(context), "upload-${java.util.UUID.randomUUID()}." + name.substringAfterLast('.'))
                    file = dest
                    context.contentResolver.openInputStream(uri)?.use { input -> dest.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024); var size = 0L
                        while (true) { val n = input.read(buffer); if (n < 0) break; size += n; if (size > config.meetingMaxBytes) throw MeetingFileProblem(R.string.meet_too_large); output.write(buffer, 0, n) }
                    } } ?: throw MeetingFileProblem(R.string.meet_audio_missing)
                    if (dest.length() == 0L) throw MeetingFileProblem(R.string.meet_empty_file)
                    val seconds = runCatching { val reader = MediaMetadataRetriever(); try { reader.setDataSource(dest.absolutePath); reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000) } finally { reader.release() } }.getOrNull()
                    if (seconds != null && seconds > config.meetingMaxMinutes * 60) throw MeetingFileProblem(R.string.meet_too_long)
                    Triple(dest, name, seconds)
                }
                localName = prepared.first.name; fileName = prepared.second; duration = prepared.third; mime = context.contentResolver.getType(uri) ?: "audio/" + fileName.substringAfterLast('.')
                source = "upload"; recordedAt = null
                if (title.isBlank()) title = fileName.substringBeforeLast('.')
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) { file?.delete(); problem = (e as? MeetingFileProblem)?.resource ?: R.string.meet_audio_missing }
            finally { busy = false }
        }
    }
    LaunchedEffect(shared) { shared?.let { pick(Uri.parse(it)); container.meetingSharedAudio.value = null } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(::pick) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) { localName = null; MeetingRecording.command(context, "start") } else problem = R.string.meet_permission
    }
    val c = Nx.colors
    Column(Modifier.fillMaxSize().background(c.background)) {
        PageHeader(stringResource(if (uploaded?.status != "UPLOADING" && uploaded != null) R.string.meet_uploaded else R.string.meet_new), onBack = onBack, leading = { MeetingBeta() })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!config.meetingNotesEnabled) { Text(stringResource(R.string.meet_not_available)); return@Column }
            if (uploadedId == null) {
                OutlinedTextField(title, { title = it }, label = { Text(stringResource(R.string.meet_title_field)) }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                GPicker(stringResource(R.string.meet_project), projects.firstOrNull { it.id == project }?.name, listOf("" to stringResource(R.string.meet_none)) + projects.map { it.id to it.name }, !busy) { project = it.takeIf { it.isNotEmpty() } }
                if (projectsFailed) Text(stringResource(R.string.meet_load_failed), color = c.dangerText)
                GPicker(stringResource(R.string.meet_language), when (language) { "id" -> stringResource(R.string.meet_indonesian); "en" -> stringResource(R.string.meet_english); else -> stringResource(R.string.meet_auto) }, listOf("auto" to stringResource(R.string.meet_auto), "id" to stringResource(R.string.meet_indonesian), "en" to stringResource(R.string.meet_english)), !busy) { language = it }
                if (!recording.recording) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxButton(stringResource(R.string.meet_upload), { picker.launch(arrayOf("audio/*", "video/mp4", "video/quicktime")) }, enabled = !busy)
                    NxButton(stringResource(R.string.meet_record), { permission.launch(Manifest.permission.RECORD_AUDIO) }, enabled = !busy, icon = Icons.Outlined.Mic)
                }
                if (recording.recording) {
                    Text(stringResource(if (recording.paused) R.string.meet_paused else R.string.meet_recording) + " · " + MeetingRules.timestamp(recording.seconds), color = c.foreground, fontWeight = FontWeight.SemiBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NxButton(stringResource(if (recording.paused) R.string.meet_resume else R.string.meet_pause), { MeetingRecording.command(context, if (recording.paused) "resume" else "pause") })
                        NxButton(stringResource(R.string.meet_stop), { MeetingRecording.command(context, "stop") }, kind = NxButtonKind.DESTRUCTIVE)
                    }
                }
                if (recording.failed) Text(stringResource(R.string.meet_record_failed), color = c.dangerText)
                if (recording.limitReached) Text(stringResource(R.string.meet_limit_reached), color = c.warningFg)
                if (localName != null) {
                    Text(fileName, color = c.foreground)
                    duration?.let { Text(MeetingRules.timestamp(it), color = c.mutedFg) }
                }
                Text(stringResource(R.string.meet_max, config.meetingMaxMinutes.toString()), fontSize = 12.sp, color = c.mutedFg)
                Text(stringResource(R.string.meet_retention, config.meetingAudioRetentionDays.toString()), fontSize = 12.sp, color = c.mutedFg)
                NxButton(stringResource(R.string.meet_send), {
                    val file = localName?.let { File(MeetingFiles.directory(context), it) } ?: return@NxButton
                    if (!file.isFile) { problem = R.string.meet_audio_missing; return@NxButton }
                    busy = true; problem = null
                    scope.launch {
                        try {
                            val answer = api.create(buildJsonObject { put("fileName", fileName); put("mime", mime); put("size", file.length()); put("title", title.ifBlank { fileName.substringBeforeLast('.') }); project?.let { put("projectId", it) }; put("language", language); put("source", source); recordedAt?.let { put("recordedAt", it) }; duration?.let { put("durationSec", it) } })
                            MeetingFiles.enqueue(context, container.sessionStore.current!!.userId, answer.meeting.id, file, minOf(answer.upload.chunkBytes, answer.upload.maxChunkBytes))
                            context.getSharedPreferences("meeting-recording", Context.MODE_PRIVATE).edit().clear().apply()
                            MeetingRecording.state.value = RecordingState()
                            uploadedId = answer.meeting.id; uploaded = answer.meeting
                        } catch (e: ApiError) { problem = meetingProblem((e as? ApiError.Http)?.code) }
                        finally { busy = false }
                    }
                }, kind = NxButtonKind.PRIMARY, enabled = !busy && localName != null && !recording.recording)
            } else {
                uploaded?.let { m ->
                    Text(m.title, fontWeight = FontWeight.SemiBold)
                    Text(meetingStatus(m.status))
                    if (m.status == "UPLOADING") { LinearProgressIndicator(progress = { if (m.audio.bytes > 0) (m.audio.received.toFloat() / m.audio.bytes).coerceIn(0f, 1f) else 0f }, modifier = Modifier.fillMaxWidth()); Text(stringResource(R.string.meet_upload_hint), color = c.mutedFg) }
                    else if (m.status == "FAILED") Text(stringResource(meetingProblem(m.errorCode)), color = c.dangerText)
                    else if (m.working) MeetingQueueBlock(m)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxButton(stringResource(R.string.meet_close), onBack)
                    NxButton(stringResource(R.string.meet_open), { val id = uploadedId!!; onBack(); container.router.open(Target.Meeting(id)) }, kind = NxButtonKind.PRIMARY)
                }
            }
            if (busy) CircularProgressIndicator()
            problem?.let { Text(stringResource(it), color = c.dangerText) }
        }
    }
}

private class MeetingFileProblem(val resource: Int) : Exception()

internal fun meetingDateTime(value: String?): String = value?.let { runCatching {
    java.time.Instant.parse(it).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE).format(id.znetworks.nexus.core.i18n.AppDateFormats.ofPattern("d MMM yyyy HH:mm")) + " WIB"
}.getOrNull() } ?: "—"
