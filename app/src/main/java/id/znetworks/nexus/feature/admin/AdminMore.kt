package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.background
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
                                      val createdAt: String? = null, val seenCount: Int = 0, val repeatUntil: String? = null, val repeatAtTime: String? = null, val targetCount: Int? = null)
@Serializable data class Announcements(val announcements: List<Announcement> = emptyList())
@Serializable data class UsageUser(val id: String, val name: String? = null, val avatar: String? = null, val asked: Int = 0, val answered: Int = 0, val toolCalls: Int = 0, val lastUsed: String? = null)
@Serializable data class UsageTotals(val people: Int = 0, val asked: Int = 0, val toolCalls: Int = 0)
@Serializable data class GideonUsage(val users: List<UsageUser> = emptyList(), val totals: UsageTotals = UsageTotals())
@Serializable data class InstallUser(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
@Serializable data class Install(val id: String, val appVersion: String? = null, val buildNumber: String? = null, val osVersion: String? = null,
                                 val deviceModel: String? = null, val platform: String? = null, val lastSeenAt: String? = null, val user: InstallUser? = null)
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

    /** Repeat keys only when repeating, as iOS: the server requires repeatAtTime once repeatDays > 0. */
    fun body(title: String, body: String, tone: String, repeatDays: Int, at: String) = buildJsonObject {
        put("title", title.trim()); put("body", body.trim()); put("tone", tone)
        if (repeatDays > 0) { put("repeatDays", repeatDays); put("repeatAtTime", at) }
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
    suspend fun announce(title: String, body: String, tone: String, repeatDays: Int, at: String) =
        send("POST", "/api/announcements", AnnounceRules.body(title, body, tone, repeatDays, at))
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
                    OutlinedTextField(title, { title = it }, singleLine = true, label = { Text(stringResource(R.string.qa_title)) }, placeholder = { Text(stringResource(R.string.qa_title_ph)) }, modifier = Modifier.fillMaxWidth())
                    Column { listOf("task_count", "overdue_cleared", "priority_done", "has_overdue").forEach { t -> Row(verticalAlignment = Alignment.CenterVertically) {
                        FilterChip(type == t, { type = t }, { Text(questType(t, null) ?: t, fontSize = 12.sp) }) } } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(count, { count = it.filter(Char::isDigit).take(3) }, singleLine = true, label = { Text("N") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        OutlinedTextField(xp, { xp = it.filter(Char::isDigit).take(2) }, singleLine = true, label = { Text("XP (≤ 50)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
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
                    Text(a.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                    Pill(stringResource(if (a.active) R.string.an_active else R.string.an_inactive), if (a.active) c.success else c.mutedFg)
                    IconButton(onClick = { run { api.deleteAnnouncement(a.id) } }) { Icon(Icons.Filled.Close, stringResource(R.string.delete), tint = c.danger) }
                }
                Text(a.body, fontSize = 13.sp, color = c.foreground, maxLines = 4)
                Text(listOfNotNull(chatTime(a.createdAt), stringResource(R.string.an_read_by, a.seenCount),
                    a.repeatUntil?.let { stringResource(R.string.an_repeats, it.take(10), a.repeatAtTime.orEmpty()) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                TextButton(onClick = { run { api.setActive(a.id, !a.active) } }) { Text(stringResource(if (a.active) R.string.an_deactivate else R.string.an_activate)) }
            }
        }
    }
    if (creating) {
        var title by rememberSaveable { mutableStateOf("") }
        var body by rememberSaveable { mutableStateOf("") }
        var tone by rememberSaveable { mutableStateOf("info") }
        var repeat by rememberSaveable { mutableIntStateOf(0) }
        var at by rememberSaveable { mutableStateOf("09:00") }
        var pickTime by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { creating = false }, title = { Text(stringResource(R.string.an_new)) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(title, { title = it }, singleLine = true, label = { Text(stringResource(R.string.an_title)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(body, { body = it }, minLines = 3, label = { Text(stringResource(R.string.an_body)) }, modifier = Modifier.fillMaxWidth())
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AnnounceRules.TONES.forEach { t -> FilterChip(tone == t, { tone = t }, { Text(t) }) } }
                    Text(stringResource(R.string.an_repeat), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AnnounceRules.REPEAT.forEach { d -> FilterChip(repeat == d, { repeat = d }, { Text(if (d == 0) stringResource(R.string.an_once) else stringResource(R.string.an_plus_days, d)) }) }
                    }
                    if (repeat > 0) {
                        TextButton(onClick = { pickTime = true }) { Text(stringResource(R.string.an_time_wib, at)) }
                        Text(stringResource(R.string.an_repeat_note), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { creating = false; run { api.announce(title, body, tone, repeat, at) } }, enabled = title.isNotBlank() && body.isNotBlank()) { Text(stringResource(R.string.th_post)) } },
            dismissButton = { TextButton(onClick = { creating = false }) { Text(stringResource(R.string.cancel)) } })
        if (pickTime) {
            val st = rememberTimePickerState(at.substringBefore(':').toInt(), at.substringAfter(':').toInt(), is24Hour = true)
            AlertDialog(onDismissRequest = { pickTime = false }, text = { TimePicker(st) }, confirmButton = { TextButton(onClick = { at = "%02d:%02d".format(st.hour, st.minute); pickTime = false }) { Text("OK") } })
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
}

@Composable
fun GideonUsageTab() {
    val api = moreApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var u by remember { mutableStateOf<GideonUsage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
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
            items(x.users.sortedByDescending { it.asked }, key = { it.id }) { p ->
                Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(p.name, p.avatar, 28.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(stringResource(R.string.gu_line, p.asked, p.answered, p.toolCalls) + (p.lastUsed?.let { " · " + chatTime(it) } ?: ""), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
            }
        }
    }
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
                Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(i.user?.name, i.user?.avatar, 28.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(i.user?.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(listOfNotNull(AppInstallsLogic.platformName(i.platform), i.appVersion?.let { v -> v + (i.buildNumber?.let { " ($it)" } ?: "") } ?: stringResource(R.string.ai_not_reported),
                            i.deviceModel, i.osVersion, i.lastSeenAt?.let { chatTime(it) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                    }
                }
            }
            if (x.notInstalled.isNotEmpty()) {
                item { Text(stringResource(R.string.ai_not_using_n, x.notInstalled.size), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.warning, modifier = Modifier.padding(top = 10.dp)) }
                items(x.notInstalled, key = { "n" + it.id }) { p ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(p.name, p.avatar, 24.dp); Spacer(Modifier.width(8.dp))
                        Text(p.name ?: p.email ?: "—", fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
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
}
