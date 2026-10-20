package id.znetworks.nexus.feature.gideon

import id.znetworks.nexus.ui.components.NxTextField

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.time.Instant
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

@Serializable data class Reminder(val id: String, val text: String, val remindAt: String, val firedAt: String? = null, val createdAt: String? = null)
@Serializable data class Reminders(val upcoming: List<Reminder> = emptyList(), val done: List<Reminder> = emptyList())

class RemindersApi(private val api: ApiClient) {
    suspend fun list() = api.get("/api/reminders?done=1", Reminders.serializer())
    suspend fun create(text: String, time: LocalDateTime) = api.send(Request.Builder().url(api.url("/api/reminders")).post(buildJsonObject {
        put("text", text.trim()); put("remindAt", time.atZone(OfficeTime.ZONE).toInstant().toString())
    }.toString().toJsonBody()).build(), JsonObject.serializer())
    suspend fun cancel(id: String) = api.send(Request.Builder().url(api.url("/api/reminders/" + java.net.URLEncoder.encode(id, "UTF-8"))).delete().build(), JsonObject.serializer())
}

internal fun reminderProblem(code: String?) = when (code) {
    "TEXT" -> R.string.rem_text_error
    "TIME_PAST", "TIME_BAD", "TIME_FAR" -> R.string.rem_time_error
    "TOO_MANY" -> R.string.rem_too_many
    "NOT_FOUND" -> R.string.rem_gone
    else -> R.string.rem_failed
}

@Composable fun RemindersScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val api = remember { RemindersApi((context.applicationContext as NexusApplication).container.api) }
    val scope = rememberCoroutineScope()
    val locale = LocalConfiguration.current.locales[0]
    val c = Nx.colors
    var data by remember { mutableStateOf<Reminders?>(null) }
    var failure by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    var timeText by rememberSaveable { mutableStateOf(LocalDateTime.now(OfficeTime.ZONE).plusHours(1).withSecond(0).withNano(0).toString()) }
    val time = LocalDateTime.parse(timeText)
    var cancel by remember { mutableStateOf<Reminder?>(null) }
    suspend fun refresh() { try { data = api.list(); failure = null } catch (_: ApiError) { failure = R.string.rem_failed } }
    LaunchedEffect(Unit) { refresh() }
    LiveRefresh(Unit, 60_000, 60_000, { it.name == "reminders-changed" }) { refresh() }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { action(); refresh() } catch (e: ApiError) { failure = reminderProblem((e as? ApiError.Http)?.code) }
            finally { busy = false }
        }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        PageHeader(stringResource(R.string.rem_title), onBack = onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    NxTextField(text, { if (it.length <= 280) text = it }, label = { Text(stringResource(R.string.rem_what)) }, modifier = Modifier.fillMaxWidth().focusRequester(focus), minLines = 2)
                    NxButton(time.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy HH:mm", locale)) + " WIB", {
                        DatePickerDialog(context, { _, y, m, d ->
                            TimePickerDialog(context, { _, h, minute -> timeText = LocalDateTime.of(y, m + 1, d, h, minute).toString() }, time.hour, time.minute, true).show()
                        }, time.year, time.monthValue - 1, time.dayOfMonth).show()
                    }, enabled = !busy)
                    NxButton(stringResource(R.string.gt_create_reminder_apply), { run { api.create(text, time); text = "" } }, kind = NxButtonKind.PRIMARY, enabled = !busy && text.isNotBlank())
                    failure?.let { Text(stringResource(it), color = c.dangerText); TextButton(onClick = { scope.launch { refresh() } }) { Text(stringResource(R.string.gx_try_again)) } }
                }
            }
            if (data == null && failure == null) item { CircularProgressIndicator() }
            val lists = listOf(R.string.rem_upcoming to data?.upcoming.orEmpty(), R.string.rem_done to data?.done.orEmpty())
            lists.forEach { (label, rows) ->
                item { Text(stringResource(label), style = MaterialTheme.typography.titleSmall) }
                items(rows, key = { it.id }) { r ->
                    Row(Modifier.fillMaxWidth().background(c.card, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(r.text, color = c.foreground)
                            Text(runCatching { Instant.parse(r.remindAt).atZone(OfficeTime.ZONE).format(DateTimeFormatter.ofPattern("EEE d MMM HH:mm", locale)) + " WIB" }.getOrDefault(r.remindAt), color = c.mutedFg)
                        }
                        if (label == R.string.rem_upcoming) IconButton(onClick = { cancel = r }, enabled = !busy) { Icon(Icons.Outlined.Close, stringResource(R.string.gt_cancel_reminder_title)) }
                    }
                }
            }
            if (data != null && data!!.upcoming.isEmpty() && data!!.done.isEmpty()) item { EmptyState(Icons.Outlined.Alarm, stringResource(R.string.rem_empty), stringResource(R.string.rem_empty_hint), stringResource(R.string.gt_create_reminder_apply), { focus.requestFocus() }) }
        }
    }
    cancel?.let { r -> AlertDialog(onDismissRequest = { cancel = null }, title = { Text(stringResource(R.string.gt_cancel_reminder_title)) }, text = { Text(r.text) }, confirmButton = {
        TextButton(onClick = { cancel = null; run { api.cancel(r.id) } }) { Text(stringResource(R.string.gt_cancel_reminder_apply), color = c.dangerText) }
    }, dismissButton = { TextButton(onClick = { cancel = null }) { Text(stringResource(R.string.cancel)) } }) }
}
