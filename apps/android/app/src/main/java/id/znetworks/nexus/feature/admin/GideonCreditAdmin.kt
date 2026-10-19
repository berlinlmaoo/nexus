package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.NxSwitch

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder

class GideonCreditAdminApi(private val api: ApiClient) {
    suspend fun people() = api.get("/api/gideon/credits/admin", JsonObject.serializer())
    suspend fun bonuses(user: String) = api.get("/api/gideon/credits/admin/bonus?userId=" + URLEncoder.encode(user, "UTF-8"), JsonObject.serializer())
    suspend fun limits(body: JsonObject) = send("override", "PUT", body)
    suspend fun grant(body: JsonObject) = send("bonus", "POST", body)
    suspend fun policy(policy: JsonObject) = api.send(Request.Builder().url(api.url("/api/gideon/credits/admin"))
        .put(buildJsonObject { put("policy", policy) }.toString().toJsonBody()).build(), JsonObject.serializer())
    private suspend fun send(path: String, method: String, body: JsonObject) = api.send(Request.Builder()
        .url(api.url("/api/gideon/credits/admin/$path")).method(method, body.toString().toJsonBody()).build(), JsonObject.serializer())
}

@Composable
internal fun GideonCreditAdminTab() {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    if (!container.viewer.isBoD) return
    val api = remember { GideonCreditAdminApi(container.api) }
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var draft by remember { mutableStateOf<JsonObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<JsonObject?>(null) }
    var query by remember { mutableStateOf("") }
    val text = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(retry) {
        try {
            val response = api.people(); data = response; draft = response.objectAt("policy"); error = null
            text.clear()
            draft!!.objectAt("roles").forEach { (role, value) ->
                val row = value as? JsonObject ?: return@forEach
                listOf("daily", "monthly").forEach { text["$role:$it"] = row.number(it)?.toInt()?.toString().orEmpty() }
            }
        } catch (e: ApiError) { error = e.describe(context.resources) }
    }
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().dismissKeyboardOnTapOrDrag(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(stringResource(R.string.gca_role_defaults), style = MaterialTheme.typography.titleLarge)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }, enabled = !busy) { Text(stringResource(R.string.try_again)) } }
            if (data == null && error == null) CircularProgressIndicator()
        }
        draft?.objectAt("roles")?.forEach { (role, value) ->
            val row = value as? JsonObject ?: return@forEach
            item(key = role) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(when (role) { "ONE_ABOVE_ALL" -> "One Above All"; "BOD" -> stringResource(R.string.gca_board); "MANAGER" -> stringResource(R.string.gca_manager); else -> stringResource(R.string.gca_staff) })
                        Row {
                            NxSwitch(row.flag("unlimited"), { unlimited ->
                                val roles = draft!!.objectAt("roles")
                                draft = JsonObject(draft!! + ("roles" to JsonObject(roles + (role to JsonObject(row + ("unlimited" to JsonPrimitive(unlimited)))))))
                            }, enabled = !busy)
                            Text(stringResource(R.string.gc_unlimited), Modifier.padding(12.dp))
                        }
                        if (!row.flag("unlimited")) {
                            CreditNumber(text["$role:daily"].orEmpty(), R.string.gca_daily, !busy) { text["$role:daily"] = it }
                            CreditNumber(text["$role:monthly"].orEmpty(), R.string.gca_period, !busy) { text["$role:monthly"] = it }
                        }
                    }
                }
            }
        }
        if (draft != null) item {
            Button(onClick = { scope.launch {
                busy = true; error = null
                val roles = JsonObject(draft!!.objectAt("roles").mapValues { (role, value) ->
                    val row = value as JsonObject
                    JsonObject(row + listOf("daily", "monthly").associateWith { key ->
                        CreditAdminDraft.limit(text["$role:$key"].orEmpty())?.let(::JsonPrimitive) ?: row[key] ?: JsonPrimitive(0)
                    })
                })
                try { api.policy(JsonObject(draft!! + ("roles" to roles))); retry++ }
                catch (e: ApiError) { error = e.describe(context.resources) }
                busy = false
            } }, enabled = !busy && draft!!.objectAt("roles").all { (role, value) ->
                (value as JsonObject).flag("unlimited") || listOf("daily", "monthly").all { CreditAdminDraft.limit(text["$role:$it"].orEmpty()) != null }
            }) { Text(stringResource(R.string.gca_save_defaults)) }
            NxTextField(query, { query = it }, label = { Text(stringResource(R.string.crew_search)) }, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
        }
        data?.rows("people")?.filter { (it.text("name") + " " + it.text("email")).contains(query.trim(), true) }?.forEach { person ->
            item(key = "person:" + person.text("id")) {
                TextButton(onClick = { selected = person }, enabled = !busy) { Text(person.text("name").ifEmpty { person.text("email") }) }
            }
        }
    }
    selected?.let { person -> GideonPersonSheet(person.text("id"), person.text("name")) { selected = null; retry++ } }
}

object CreditAdminDraft {
    fun limit(value: String) = value.toIntOrNull()?.takeIf { it in 0..10_000_000 }
    fun override(user: String, roleDefault: Boolean, unlimited: Boolean, daily: String, monthly: String, note: String) = buildJsonObject {
        put("userId", user)
        put("dailyLimit", if (roleDefault) JsonNull else limit(daily)?.let(::JsonPrimitive) ?: JsonNull)
        put("monthlyLimit", if (roleDefault) JsonNull else limit(monthly)?.let(::JsonPrimitive) ?: JsonNull)
        put("unlimited", if (roleDefault) JsonNull else JsonPrimitive(unlimited))
        put("note", if (roleDefault) JsonNull else JsonPrimitive(note.trim()))
    }
}

@Composable
internal fun GideonPersonCredits(userId: String, summary: GPersonOverview, saved: () -> Unit) {
    val context = LocalContext.current
    val api = remember { GideonCreditAdminApi((context.applicationContext as NexusApplication).container.api) }
    val scope = rememberCoroutineScope()
    var person by remember(userId) { mutableStateOf<JsonObject?>(null) }
    var bonuses by remember(userId) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var roleDefault by remember(userId) { mutableStateOf(true) }
    var unlimited by remember(userId) { mutableStateOf(false) }
    var daily by remember(userId) { mutableStateOf("") }
    var monthly by remember(userId) { mutableStateOf("") }
    var note by remember(userId) { mutableStateOf("") }
    var bonus by remember(userId) { mutableStateOf("") }
    var reason by remember(userId) { mutableStateOf("") }
    var error by remember(userId) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var retry by remember { mutableIntStateOf(0) }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(userId, retry) {
        loading = true
        try {
            val p = api.people().rows("people").firstOrNull { it.text("id") == userId }
            person = p
            if (p != null) {
                roleDefault = p["override"] == null || p["override"] == JsonNull
                val limits = p.objectAt("limits"); val own = p.objectAt("override")
                unlimited = (own["unlimited"] as? JsonPrimitive)?.booleanOrNull ?: limits.flag("unlimited")
                daily = (own.number("dailyLimit") ?: limits.number("daily"))?.toInt()?.toString().orEmpty()
                monthly = (own.number("monthlyLimit") ?: limits.number("monthly"))?.toInt()?.toString().orEmpty()
                note = own.text("note")
            }
            bonuses = api.bonuses(userId).rows("bonuses"); error = null
        } catch (e: ApiError) { person = null; error = e.describe(context.resources) }
        loading = false
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.gp_period_used, summary.credits.used))
        Text(summary.credits.period.startKey + " – " + summary.credits.period.endKey)
        Text(stringResource(R.string.gp_today_used, summary.credits.todayUsed))
        if (loading) CircularProgressIndicator()
        error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }, enabled = !busy) { Text(stringResource(R.string.try_again)) } }
        person?.let { p ->
            val limits = p.objectAt("limits")
            Text(if (limits.flag("unlimited")) stringResource(R.string.gc_unlimited) else stringResource(R.string.gp_limits,
                limits.number("daily")?.toInt() ?: 0, (limits.number("monthly") ?: 0.0).toInt() + (limits.number("bonus") ?: 0.0).toInt()))
            Row { NxSwitch(roleDefault, { roleDefault = it }, enabled = !busy && !loading); Text(stringResource(R.string.gca_role_default), Modifier.padding(12.dp)) }
            if (!roleDefault) {
                Row { NxSwitch(unlimited, { unlimited = it }, enabled = !busy && !loading); Text(stringResource(R.string.gc_unlimited), Modifier.padding(12.dp)) }
                if (!unlimited) {
                    CreditNumber(daily, R.string.gca_daily, !busy && !loading) { daily = it }
                    CreditNumber(monthly, R.string.gca_period, !busy && !loading) { monthly = it }
                }
                NxTextField(note, { if (it.length <= 300) note = it }, label = { Text(stringResource(R.string.gca_note)) }, enabled = !busy && !loading, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
            }
            Button(onClick = { scope.launch {
                busy = true; error = null
                try { api.limits(CreditAdminDraft.override(userId, roleDefault, unlimited, daily, monthly, note)); retry++; saved() }
                catch (e: ApiError) { error = e.describe(context.resources) }
                busy = false
            } }, enabled = !busy && !loading && (roleDefault || unlimited || (CreditAdminDraft.limit(daily) != null && CreditAdminDraft.limit(monthly) != null))) { Text(stringResource(R.string.gca_save_limits)) }
            HorizontalDivider()
            Text(stringResource(R.string.gca_bonus), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.gca_bonus_help))
            CreditNumber(bonus, R.string.gca_credits, !busy && !loading) { bonus = it }
            NxTextField(reason, { if (it.length <= 300) reason = it }, label = { Text(stringResource(R.string.gca_reason)) }, enabled = !busy && !loading, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
            Button(onClick = { confirm = true }, enabled = !busy && !loading && bonus.toIntOrNull() in 1..100_000) { Text(stringResource(R.string.gca_grant)) }
            bonuses.forEach { b -> Text("+${b.number("credits")?.toInt() ?: 0} · ${b.text("reason")} · ${chatTime(b.text("createdAt"))}") }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { if (!busy) confirm = false }, title = { Text(stringResource(R.string.gca_confirm, bonus)) },
        text = { Column { Text(stringResource(R.string.gca_bonus_help)); error?.let { Text(it, color = MaterialTheme.colorScheme.error) } } },
        confirmButton = { TextButton(onClick = { scope.launch {
            busy = true; error = null
            try {
                api.grant(buildJsonObject { put("userId", userId); put("credits", bonus.toInt()); put("reason", reason.trim()) })
                bonus = ""; reason = ""; confirm = false; retry++; saved()
            } catch (e: ApiError) { error = e.describe(context.resources) }
            busy = false
        } }, enabled = !busy) { Text(stringResource(R.string.gca_grant)) } }, dismissButton = { TextButton(onClick = { confirm = false }, enabled = !busy) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun CreditNumber(value: String, label: Int, enabled: Boolean, change: (String) -> Unit) {
    NxTextField(value, { if (it.isEmpty() || it.all(Char::isDigit)) change(it) }, label = { Text(stringResource(label)) },
        enabled = enabled, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = androidx.compose.ui.text.input.ImeAction.Done), modifier = Modifier.fillMaxWidth())
}
