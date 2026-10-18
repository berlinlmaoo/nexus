package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.material.icons.filled.PhoneIphone
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import androidx.compose.material.icons.filled.Description
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.time.Instant
import java.time.ZoneOffset

// Control Room: Quests, Announcements, GIDEON usage, App installs (API.md §2.5/§2.6).

@Serializable data class AdminQuest(val id: String, val title: String = "", val requirementType: String? = null, val requiredCount: Int? = null,
                                    val xpReward: Int = 0, val deadline: String? = null, val taskIds: List<String> = emptyList())
@Serializable data class AdminQuests(val quests: List<AdminQuest> = emptyList())
@Serializable data class Announcement(val id: String, val title: String = "", val body: String = "", val tone: String? = null, val active: Boolean = false,
                                      val createdAt: String? = null, val seenCount: Int = 0, val repeatUntil: String? = null, val repeatAtTime: String? = null, val targetCount: Int? = null,
                                      /** Batch 2: "announcement" | "warning" | "sp", the SP's PDF, and who it went to (empty = everyone). */
                                      val kind: String? = null, val imageUrl: String? = null, val attachmentUrl: String? = null, val attachmentName: String? = null,
                                      val targets: List<AnnounceTarget> = emptyList(), val targetUserIds: List<String> = emptyList())
@Serializable data class AnnounceTarget(val id: String, val name: String? = null)
/** `POST /api/announcements/attachment` → 201. */
@Serializable data class AnnounceAttachment(val url: String, val name: String? = null, val size: Long? = null)
@Serializable data class Announcements(val announcements: List<Announcement> = emptyList())
@Serializable data class UsageUser(val id: String, val name: String? = null, val avatar: String? = null, val asked: Int = 0, val answered: Int = 0, val toolCalls: Int = 0, val lastUsed: String? = null)
@Serializable data class UsageTotals(val people: Int = 0, val asked: Int = 0, val toolCalls: Int = 0)
@Serializable data class GideonUsage(val users: List<UsageUser> = emptyList(), val totals: UsageTotals = UsageTotals())
@Serializable data class InstallUser(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
@Serializable data class Install(val id: String, val appVersion: String? = null, val buildNumber: String? = null, val osVersion: String? = null,
                                 val deviceModel: String? = null, val platform: String? = null, val lastSeenAt: String? = null, val user: InstallUser? = null,
                                 /** Every active device of this person, newest first (server 29 Sep 2026); empty on older servers. */
                                 val devices: List<InstallDevice> = emptyList())
@Serializable data class InstallDevice(val id: String, val platform: String? = null, val appVersion: String? = null, val buildNumber: String? = null,
                                       val osVersion: String? = null, val deviceModel: String? = null, val lastSeenAt: String? = null)
@Serializable data class NotInstalled(val id: String, val name: String? = null, val email: String? = null, val avatar: String? = null, val role: String? = null, val lastActiveAt: String? = null)
@Serializable data class VersionCount(val version: String = "", val count: Int = 0)
@Serializable data class InstallTotals(val people: Int = 0, val devices: Int = 0, val members: Int = 0, val notInstalled: Int = 0,
                                       val versions: List<VersionCount> = emptyList(), val platforms: Map<String, Int> = emptyMap(),
                                       val versionsByPlatform: Map<String, List<VersionCount>> = emptyMap())
@Serializable data class AppInstalls(val installs: List<Install> = emptyList(), val notInstalled: List<NotInstalled> = emptyList(), val totals: InstallTotals = InstallTotals())

object AnnounceRules {
    val REPEAT = listOf(0, 2, 3, 5, 7)
    val TONES = listOf("info", "success", "warning")
    const val MAX_XP = 50

    const val PDF_MAX_BYTES = 10L * 1024 * 1024

    /**
     * Repeat keys only when repeating, as iOS: the server requires repeatAtTime once repeatDays > 0.
     * Batch 2: [targets] only when not everyone; a PDF makes it an SP (kind "sp"), as iOS 78bfe37.
     */
    fun body(title: String, body: String, tone: String, repeatDays: Int, at: String,
             targets: List<String> = emptyList(), pdf: AnnounceAttachment? = null) = buildJsonObject {
        put("title", title.trim()); put("body", body.trim()); put("tone", tone)
        if (repeatDays > 0) { put("repeatDays", repeatDays); put("repeatAtTime", at) }
        if (targets.isNotEmpty()) put("targetUserIds", kotlinx.serialization.json.JsonArray(targets.distinct().map { kotlinx.serialization.json.JsonPrimitive(it) }))
        pdf?.let { put("attachmentUrl", it.url); put("attachmentName", it.name ?: "SP.pdf"); put("kind", "sp") }
    }

    /** Why Post is off (iOS): a title, a body, and at least one person when not everyone. */
    /** The roster to pick from (iOS): people with an account, name or email search, A–Z, at most 60 rows. */
    fun rosterRows(members: List<WsMember>, search: String): List<WsMember> {
        val q = search.trim().lowercase()
        return members.filter { it.userId.isNotBlank() && (q.isEmpty() || it.displayName.lowercase().contains(q) || it.email.orEmpty().lowercase().contains(q)) }
            .distinctBy { it.userId }.sortedBy { it.displayName.lowercase() }.take(60)
    }

    enum class Missing { TITLE, BODY, PEOPLE }
    fun missing(title: String, body: String, everyone: Boolean, picked: Set<String>) = when {
        title.isBlank() -> Missing.TITLE
        body.isBlank() -> Missing.BODY
        !everyone && picked.isEmpty() -> Missing.PEOPLE
        else -> null
    }
}

class AdminMoreApi(private val api: ApiClient) {
    private suspend fun send(method: String, path: String, body: JsonObject?) =
        api.send(Request.Builder().url(api.url(path)).method(method, body?.toString()?.toJsonBody()).build(), JsonObject.serializer())
    suspend fun quests(ws: String) = api.get("/api/gamification/quests/admin?workspaceId=$ws", AdminQuests.serializer()).quests
    suspend fun createQuest(ws: String, title: String, type: String, count: Int, xp: Int, deadline: String?) = send("POST", "/api/gamification/quests/admin", buildJsonObject {
        put("workspaceId", ws); put("title", title.trim()); put("requirementType", type); put("requiredCount", count); put("xpReward", xp.coerceIn(0, AnnounceRules.MAX_XP))
        deadline?.let { put("deadline", it) }
    })
    suspend fun deleteQuest(id: String) = send("DELETE", "/api/gamification/quests/admin?id=$id", null)
    suspend fun announcements() = api.get("/api/announcements", Announcements.serializer()).announcements
    suspend fun announce(title: String, body: String, tone: String, repeatDays: Int, at: String, targets: List<String> = emptyList(), pdf: AnnounceAttachment? = null) =
        send("POST", "/api/announcements", AnnounceRules.body(title, body, tone, repeatDays, at, targets, pdf))
    /** The SP's PDF (≤ 10 MB; the server answers 413 / 415 otherwise). */
    suspend fun uploadAttachment(name: String, pdf: ByteArray): AnnounceAttachment {
        val body = okhttp3.MultipartBody.Builder().setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("file", name.replace("\"", ""), pdf.toRequestBody("application/pdf".toMediaType()))
            .build()
        return api.send(Request.Builder().url(api.url("/api/announcements/attachment")).post(body).build(), AnnounceAttachment.serializer())
    }
    suspend fun setActive(id: String, active: Boolean) = send("PATCH", "/api/announcements/$id", buildJsonObject { put("active", active) })
    suspend fun deleteAnnouncement(id: String) = send("DELETE", "/api/announcements/$id", null)
    suspend fun gideonUsage() = api.get("/api/gideon/usage", GideonUsage.serializer())
    suspend fun installs() = api.get("/api/admin/app-installs", AppInstalls.serializer())
}

@Composable
private fun moreApi(): AdminMoreApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { AdminMoreApi(c.api) }
}

@Composable
private fun workspaceId(): String? {
    val admin = adminApi()
    var ws by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { ws = runCatching { admin.roster(includeRegistered = false).workspaceId }.getOrNull() }
    return ws
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuestsTab() {
    val api = moreApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    val ws = workspaceId()
    var list by remember { mutableStateOf<List<AdminQuest>?>(null) }
    var creating by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(ws, tick) { if (ws != null) list = runCatching { api.quests(ws) }.getOrDefault(emptyList()) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = { creating = true }, enabled = ws != null, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.qa_new)) }
        val l = list
        if (l == null) CircularProgressIndicator(Modifier.size(20.dp))
        else if (l.isEmpty()) TabEmpty(Icons.Filled.EmojiEvents, stringResource(R.string.qa_empty))
        l?.forEach { q ->
            AdminCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(q.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(listOfNotNull(questType(q.requirementType, q.requiredCount), q.deadline?.take(10)?.let { stringResource(R.string.qa_until, it) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                    }
                    Pill("+${q.xpReward} XP", c.violetText)
                    IconButton(onClick = { scope.launch { runCatching { api.deleteQuest(q.id) }.onFailure { e -> notice = (e as? ApiError)?.describe(res) }; tick++ } }) {
                        Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.mutedFg)
                    }
                }
            }
        }
    }
    if (creating && ws != null) {
        var title by rememberSaveable { mutableStateOf("") }
        var type by rememberSaveable { mutableStateOf("task_count") }
        var count by rememberSaveable { mutableStateOf("5") }
        var xp by rememberSaveable { mutableStateOf("20") }
        var deadline by remember { mutableStateOf<String?>(null) }
        var pickDate by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { creating = false }, title = { Text(stringResource(R.string.qa_new)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(title, { title = it }, singleLine = true, label = { Text(stringResource(R.string.qa_title)) }, placeholder = { Text(stringResource(R.string.qa_title_ph)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
                    Column { listOf("task_count", "overdue_cleared", "priority_done").forEach { t -> Row(verticalAlignment = Alignment.CenterVertically) {
                        FilterChip(type == t, { type = t }, { Text(questType(t, null) ?: t, fontSize = 12.sp) }) } } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(count, { count = it.filter(Char::isDigit).take(3) }, singleLine = true, label = { Text("N") }, keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done, keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        OutlinedTextField(xp, { xp = it.filter(Char::isDigit).take(2) }, singleLine = true, label = { Text("XP (≤ 50)") }, keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done, keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    }
                    TextButton(onClick = { pickDate = true }) { Text(deadline?.let { stringResource(R.string.qa_until, it) } ?: stringResource(R.string.qa_add_deadline)) }
                }
            },
            confirmButton = { TextButton(onClick = {
                creating = false
                scope.launch { try { api.createQuest(ws, title, type, count.toIntOrNull() ?: 5, xp.toIntOrNull() ?: 0, deadline); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
            }, enabled = title.isNotBlank() && (count.toIntOrNull() ?: 0) > 0 && (xp.toIntOrNull() ?: -1) in 0..50) { Text(stringResource(R.string.td_create_quest)) } },
            dismissButton = { TextButton(onClick = { creating = false }) { Text(stringResource(R.string.cancel)) } })
        if (pickDate) {
            val st = rememberDatePickerState()
            DatePickerDialog(onDismissRequest = { pickDate = false }, confirmButton = {
                TextButton(onClick = { st.selectedDateMillis?.let { deadline = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }; pickDate = false }) { Text("OK") }
            }, dismissButton = { TextButton(onClick = { deadline = null; pickDate = false }) { Text(stringResource(R.string.td_clear_date)) } }) { DatePicker(st) }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

@Composable
private fun questType(t: String?, n: Int?): String? {
    val count = n ?: 0
    return when (t) {
        "task_count" -> if (n != null) stringResource(R.string.qa_task_count_n, count) else stringResource(R.string.qa_task_count)
        "overdue_cleared" -> if (n != null) stringResource(R.string.qa_overdue_cleared_n, count) else stringResource(R.string.qa_overdue_cleared)
        "priority_done" -> if (n != null) stringResource(R.string.qa_priority_done_n, count) else stringResource(R.string.qa_priority_done)
        "has_overdue" -> if (n != null) stringResource(R.string.qa_has_overdue_n, count) else stringResource(R.string.qa_has_overdue)
        "specific_tasks" -> stringResource(R.string.qa_specific_tasks)
        else -> t
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AnnouncementsTab() {
    val api = moreApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Announcement>?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pdf by remember { mutableStateOf<Pair<String, String>?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { list = runCatching { api.announcements() }.getOrDefault(emptyList()) }
    fun run(block: suspend () -> Unit) = scope.launch { try { block(); tick++ } catch (e: ApiError) { notice = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.an_new)) }
        val l = list
        if (l == null) CircularProgressIndicator(Modifier.size(20.dp))
        else if (l.isEmpty()) TabEmpty(Icons.Filled.Campaign, stringResource(R.string.an_empty))
        l?.forEach { a ->
            AdminCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    when (a.kind) { "sp" -> { Pill("SP", c.danger); Spacer(Modifier.width(6.dp)) }; "warning" -> { Pill(stringResource(R.string.an_kind_warning), c.warning); Spacer(Modifier.width(6.dp)) } }
                    Text(a.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                    Pill(stringResource(if (a.active) R.string.an_active else R.string.an_inactive), if (a.active) c.success else c.mutedFg)
                    IconButton(onClick = { run { api.deleteAnnouncement(a.id) } }) { Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.danger) }
                }
                Text(a.body, fontSize = 13.sp, color = c.foreground, maxLines = 4)
                a.attachmentUrl?.let { url ->
                    TextButton(onClick = { pdf = url to (a.attachmentName ?: "SP.pdf") }) {
                        Icon(Icons.Filled.Description, null, tint = c.danger, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                        Text(a.attachmentName ?: "SP.pdf", color = c.danger, maxLines = 1)
                    }
                }
                Text(if (a.targets.isEmpty() && a.targetUserIds.isEmpty()) stringResource(R.string.an_to_everyone)
                    else stringResource(R.string.an_to_people, a.targets.mapNotNull { it.name }.ifEmpty { listOf("${a.targetCount ?: a.targetUserIds.size}") }.joinToString(", ")),
                    fontSize = 11.sp, color = c.mutedFg, maxLines = 2)
                Text(listOfNotNull(chatTime(a.createdAt), stringResource(R.string.an_read_by, a.seenCount),
                    a.repeatUntil?.let { stringResource(R.string.an_repeats, it.take(10), a.repeatAtTime.orEmpty()) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                TextButton(onClick = { run { api.setActive(a.id, !a.active) } }) { Text(stringResource(if (a.active) R.string.an_deactivate else R.string.an_activate)) }
            }
        }
    }
    if (creating) AnnouncementComposer(api, onDismiss = { creating = false }, onPosted = { creating = false; tick++ })
    pdf?.let { (url, name) -> id.znetworks.nexus.ui.components.PdfViewerDialog(url, name) { pdf = null } }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

@Composable
fun GideonUsageTab() {
    val api = moreApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var u by remember { mutableStateOf<GideonUsage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var person by remember { mutableStateOf<UsageUser?>(null) }
    LaunchedEffect(Unit) { try { u = api.gideonUsage() } catch (e: ApiError) { error = e.describe(res) } }
    val x = u
    when {
        x == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        x == null -> TabEmpty(Icons.Filled.AutoAwesome, error!!)
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(stringResource(R.string.gu_people), x.totals.people, Modifier.weight(1f)); Stat(stringResource(R.string.gu_asked), x.totals.asked, Modifier.weight(1f)); Stat(stringResource(R.string.gu_tools), x.totals.toolCalls, Modifier.weight(1f))
                }
            }
            item { Text(stringResource(R.string.gu_people), fontSize = 16.sp, color = c.foreground, fontWeight = FontWeight.SemiBold) }
            items(x.users.sortedByDescending { it.asked }, key = { it.id }) { p ->
                Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).clickable { person = p }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(p.name, p.avatar, 28.dp, userId = p.id); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(stringResource(R.string.gu_line, p.asked, p.answered, p.toolCalls) + (p.lastUsed?.let { " · " + chatTime(it) } ?: ""), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
            }
        }
    }
    person?.let { p -> GideonPersonSheet(p.id, p.name) { person = null } }
}

@Composable
private fun Stat(label: String, v: Int, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.card, RoundedCornerShape(12.dp)).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$v", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c.foreground); Text(label, fontSize = 10.sp, color = c.mutedFg)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppInstallsTab() {
    val api = moreApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var d by remember { mutableStateOf<AppInstalls?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { try { d = api.installs() } catch (e: ApiError) { error = e.describe(res) } }
    val x = d
    when {
        x == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        x == null -> TabEmpty(Icons.Filled.PhoneAndroid, error!!)
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(stringResource(R.string.ai_using), x.totals.people, Modifier.weight(1f)); Stat(stringResource(R.string.ai_not_using), x.totals.notInstalled, Modifier.weight(1f)); Stat(stringResource(R.string.ai_devices), x.totals.devices, Modifier.weight(1f))
                }
            }
            item {
                // One histogram per platform: Android and iOS version numbers never mix (older servers: one list).
                val groups = x.totals.versionsByPlatform.ifEmpty { mapOf("" to x.totals.versions) }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    groups.forEach { (p, vs) ->
                        if (p.isNotEmpty()) Text("${AppInstallsLogic.platformName(p)} · ${x.totals.platforms[p] ?: vs.sumOf { it.count }}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { vs.forEach { v -> Pill("${v.version} · ${v.count}", c.blue) } }
                    }
                }
            }
            if (x.installs.isEmpty()) item { TabEmpty(Icons.Filled.PhoneAndroid, stringResource(R.string.ai_nobody)) }
            items(x.installs, key = { it.id }) { i ->
                Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).padding(10.dp), verticalAlignment = Alignment.Top) {
                    Avatar(i.user?.name, i.user?.avatar, 28.dp, userId = i.user?.id); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(i.user?.name ?: i.user?.email ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        // One line per device (iOS 7920142): someone on an iPhone and an Android phone shows both.
                        AppInstallsLogic.devices(i).forEach { d ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (d.platform == "android") Icons.Filled.PhoneAndroid else Icons.Filled.PhoneIphone, AppInstallsLogic.platformName(d.platform),
                                    tint = c.mutedFg, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(listOfNotNull(d.osVersion ?: "—", d.deviceModel, d.lastSeenAt?.let { chatTime(it) }).joinToString(" · "),
                                    fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Spacer(Modifier.width(8.dp))
                                AppInstallsLogic.versionLabel(d)?.let { Pill(it, c.violetText) } ?: Text(stringResource(R.string.ai_not_reported), fontSize = 11.sp, color = c.mutedFg)
                            }
                        }
                    }
                }
            }
            if (x.notInstalled.isNotEmpty()) {
                item { Text(stringResource(R.string.ai_not_using_n, x.notInstalled.size), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.warning, modifier = Modifier.padding(top = 10.dp)) }
                items(x.notInstalled, key = { "n" + it.id }) { p ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(p.name, p.avatar, 24.dp, userId = p.id); Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.name ?: p.email ?: "—", fontSize = 13.sp, color = c.foreground)
                            // Signs in on the web, or never signed in at all (iOS 74c6750).
                            Text(AppInstallsLogic.activity(p.lastActiveAt)?.let { stringResource(R.string.ai_web_only, it) } ?: stringResource(R.string.ai_never_signed_in),
                                fontSize = 11.sp, color = c.mutedFg)
                        }
                        Text(Roles.label(p.role), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
            }
        }
    }
}

object AppInstallsLogic {
    /** Rows written before the server stored a platform are iOS: Android did not exist yet. */
    fun platformName(p: String?) = if (p == "android") "Android" else "iOS"
    /** The person's devices; an older server sends only the latest one on the row itself. */
    fun devices(i: Install): List<InstallDevice> = i.devices.ifEmpty {
        listOf(InstallDevice(i.id, i.platform, i.appVersion, i.buildNumber, i.osVersion, i.deviceModel, i.lastSeenAt))
    }
    /** "0.1.6 (8)", or null when the device never reported a version. */
    fun versionLabel(d: InstallDevice) = d.appVersion?.let { v -> v + (d.buildNumber?.let { " ($it)" } ?: "") }
    /** "24 Sep" of the last activity (web only), or null when the person never signed in. */
    fun activity(lastActiveAt: String?): String? = lastActiveAt?.let {
        runCatching { AppDateFormats.ofPattern("d MMM", java.util.Locale.getDefault()).format(java.time.Instant.parse(it).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE)) }.getOrNull()
    }
}
