package id.znetworks.nexus.feature.admin

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.*
import id.znetworks.nexus.feature.gideon.*
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.net.URLEncoder

@Serializable data class GPerson(val id: String, val name: String? = null, val role: String? = null)
@Serializable data class GPersonViewer(val canReadChats: Boolean = false)
@Serializable data class GPersonStats(val questions: Int = 0, val answers: Int = 0, val toolCalls: Int = 0,
    val chats: Int = 0, val deletedChats: Int? = null, val firstUsed: String? = null, val lastUsed: String? = null)
@Serializable data class GPersonTier(val tier: String, val credits: Int = 0, val answers: Int = 0)
@Serializable data class GPersonCredits(val used: Int = 0, val answers: Int = 0, val todayUsed: Int = 0,
    val period: GCreditPeriod = GCreditPeriod(), val tiers: List<GPersonTier> = emptyList())
@Serializable data class GPersonOverview(val person: GPerson, val viewer: GPersonViewer = GPersonViewer(),
    val stats: GPersonStats = GPersonStats(), val credits: GPersonCredits = GPersonCredits())
@Serializable data class GReviewChat(val id: String, val title: String? = null, val createdAt: String? = null,
    val updatedAt: String? = null, val deleted: Boolean = false, val deletedAt: String? = null,
    val tier: String? = null, val messages: Int = 0, val credits: Int = 0, val match: String? = null)
@Serializable data class GReviewChats(val chats: List<GReviewChat> = emptyList(), val total: Int = 0, val nextCursor: String? = null)
@Serializable data class GReviewTranscript(val chat: GReviewChat, val messages: List<GMessage> = emptyList(), val olderBefore: String? = null)

object GideonReviewAccess {
    fun chats(role: String?, serverAllows: Boolean) = role == "ONE_ABOVE_ALL" && serverAllows
}

/** The deployed web's people endpoints. There are deliberately no mutation methods here. */
class GideonPeopleApi(private val api: ApiClient) {
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
    private fun path(user: String) = "/api/gideon/people/" + enc(user)
    suspend fun overview(user: String) = api.get(path(user), GPersonOverview.serializer())
    suspend fun chats(user: String, query: String = "", deleted: String = "all", cursor: String? = null,
        from: String = "", to: String = ""): GReviewChats {
        val params = buildList {
            add("limit=30"); if (query.isNotBlank()) add("q=" + enc(query.trim()))
            if (deleted != "all") add("deleted=" + enc(deleted))
            if (cursor != null) add("cursor=" + enc(cursor))
            if (from.isNotBlank()) add("from=" + enc(from)); if (to.isNotBlank()) add("to=" + enc(to))
        }
        return api.get(path(user) + "/chats?" + params.joinToString("&"), GReviewChats.serializer())
    }
    suspend fun transcript(user: String, chat: String, before: String? = null) = api.get(path(user) + "/chats/" + enc(chat) +
        (before?.let { "?before=" + enc(it) } ?: ""), GReviewTranscript.serializer())
    suspend fun limits(user: String): JsonObject? = api.get("/api/gideon/credits/admin", JsonObject.serializer())["people"]?.jsonArray
        ?.mapNotNull { it as? JsonObject }?.firstOrNull { it["id"]?.jsonPrimitive?.content == user }?.get("limits") as? JsonObject
}

@Composable
fun GideonPersonSheet(userId: String, name: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { GideonPeopleApi(container.api) }
    val c = Nx.colors
    var overview by remember(userId) { mutableStateOf<GPersonOverview?>(null) }
    var limits by remember(userId) { mutableStateOf<JsonObject?>(null) }
    var error by remember(userId) { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var tab by remember { mutableStateOf("overview") }
    var selectedChat by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(userId, retry) {
        try { overview = api.overview(userId); error = null; limits = api.limits(userId) }
        catch (e: ApiError) { error = e.describe(context.resources) }
    }
    val canRead = GideonReviewAccess.chats(container.viewer.role, overview?.viewer?.canReadChats == true)
    val wide = LocalConfiguration.current.screenWidthDp >= 700
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.widthIn(max = 900.dp).fillMaxWidth().fillMaxHeight(if (wide) 0.9f else 1f), color = c.background) {
            Column(Modifier.dismissKeyboardOnTapOrDrag()) {
                PageHeader(overview?.person?.name ?: name ?: "GIDEON", onBack = {
                    if (selectedChat != null) selectedChat = null else onDismiss()
                }, tabs = {
                    PageTabs(buildList {
                        add(PageTab("overview", stringResource(R.string.gp_overview)))
                        if (canRead) add(PageTab("chats", stringResource(R.string.gx_chats)))
                        add(PageTab("credits", stringResource(R.string.gc_title)))
                    }, tab, { tab = it; selectedChat = null })
                })
                when {
                    overview == null && error == null -> CircularProgressIndicator(Modifier.padding(24.dp))
                    overview == null -> Column(Modifier.padding(20.dp)) { Text(error.orEmpty()); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.gx_try_again)) } }
                    tab == "chats" && canRead -> {
                        val chat = selectedChat
                        if (chat == null) PersonChats(api, userId) { selectedChat = it }
                        else PersonTranscript(api, userId, chat) { selectedChat = null }
                    }
                    else -> PersonOverview(overview!!, limits, tab == "credits", error)
                }
            }
        }
    }
}

@Composable private fun PersonOverview(d: GPersonOverview, limits: JsonObject?, creditsOnly: Boolean, error: String?) {
    val c = Nx.colors
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (!creditsOnly) item {
            Text(stringResource(R.string.gp_questions, d.stats.questions, d.stats.answers))
            Text(stringResource(R.string.gp_tools, d.stats.toolCalls))
            Text(stringResource(R.string.gp_chats, d.stats.chats))
            d.stats.deletedChats?.let { Text(stringResource(R.string.gp_deleted_count, it), color = c.mutedFg) }
            Text(stringResource(R.string.gp_last_used, chatTime(d.stats.lastUsed)), color = c.mutedFg)
        }
        item {
            Text(stringResource(R.string.gp_period_used, d.credits.used))
            Text(d.credits.period.startKey + " – " + d.credits.period.endKey, color = c.mutedFg, fontSize = 12.sp)
            Text(stringResource(R.string.gp_today_used, d.credits.todayUsed))
            if (creditsOnly && limits != null) {
                if (limits["unlimited"]?.jsonPrimitive?.booleanOrNull == true) Text(stringResource(R.string.gc_unlimited))
                else Text(stringResource(R.string.gp_limits, limits["daily"]?.jsonPrimitive?.intOrNull ?: 0,
                    limits["monthly"]?.jsonPrimitive?.intOrNull ?: 0))
            }
        }
        if (creditsOnly) items(d.credits.tiers, key = { it.tier }) { tier ->
            Text(tierName(tier.tier)); Text(stringResource(R.string.gp_tier_usage, tier.answers, tier.credits), color = c.mutedFg)
        }
        error?.let { item { Text(it, color = c.dangerText) } }
    }
}

private fun tierName(key: String?) = GideonTier.entries.firstOrNull { it.key == key }?.label ?: "GIDEON"

@Composable private fun PersonChats(api: GideonPeopleApi, user: String, onOpen: (String) -> Unit) {
    val res = LocalContext.current.resources
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("") }; var to by remember { mutableStateOf("") }
    var deleted by remember { mutableStateOf("all") }
    var page by remember { mutableStateOf<GReviewChats?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }; var retry by remember { mutableIntStateOf(0) }
    suspend fun load(cursor: String? = null) {
        val key = listOf(query, deleted, from, to)
        busy = true
        try {
            val next = api.chats(user, query, deleted, cursor, from, to)
            if (key != listOf(query, deleted, from, to)) return
            page = if (cursor == null) next else next.copy(chats = (page?.chats.orEmpty() + next.chats).distinctBy { it.id })
            error = null
        } catch (e: ApiError) { if (key == listOf(query, deleted, from, to)) error = if ((e as? ApiError.Http)?.code == "OAA_ONLY") res.getString(R.string.gp_oaa_only) else e.describe(res) }
        finally { if (key == listOf(query, deleted, from, to)) busy = false }
    }
    LaunchedEffect(user, query, deleted, from, to, retry) { page = null; delay(300); load() }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.gp_search)) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp), singleLine = true, keyboardOptions = AdminKeyboard.Done)
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(from, { from = it }, label = { Text(stringResource(R.string.gp_from)) }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.weight(1f))
            OutlinedTextField(to, { to = it }, label = { Text(stringResource(R.string.gp_to)) }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.weight(1f))
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("all" to R.string.gp_all, "none" to R.string.gp_kept, "only" to R.string.gp_deleted).forEach { (key, label) ->
                FilterChip(selected = deleted == key, onClick = { deleted = key }, label = { Text(stringResource(label), fontSize = 11.sp) })
            }
        }
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (busy && page == null) item { CircularProgressIndicator() }
            error?.let { item { Text(it, color = c.dangerText); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.gx_try_again)) } } }
            if (!busy && error == null && page?.chats?.isEmpty() == true) item { Text(stringResource(R.string.gp_empty)) }
            items(page?.chats.orEmpty(), key = { it.id }) { chat ->
                Column(Modifier.fillMaxWidth().clickable { onOpen(chat.id) }.padding(vertical = 8.dp)) {
                    Text(chat.title ?: stringResource(R.string.gp_untitled))
                    ChatMetadata(chat)
                    chat.match?.let { Text(it, color = c.mutedFg, fontSize = 12.sp) }
                }
            }
            if (page?.nextCursor != null) item { TextButton(enabled = !busy, onClick = { scope.launch { load(page?.nextCursor) } }) { Text(stringResource(R.string.gc_more)) } }
        }
    }
}

@Composable private fun ChatMetadata(chat: GReviewChat) {
    val c = Nx.colors
    Text(chatTime(chat.updatedAt ?: chat.createdAt) + " · " + tierName(chat.tier), fontSize = 12.sp, color = c.mutedFg)
    Text(stringResource(R.string.gp_chat_usage, chat.messages, chat.credits), fontSize = 12.sp, color = c.mutedFg)
    if (chat.deleted) Text(stringResource(R.string.gp_deleted) + (chat.deletedAt?.let { " · " + chatTime(it) } ?: ""), color = c.dangerText, fontSize = 12.sp)
}

@Composable private fun PersonTranscript(api: GideonPeopleApi, user: String, chatId: String, onBack: () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var page by remember(chatId) { mutableStateOf<GReviewTranscript?>(null) }
    var error by remember(chatId) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }; var retry by remember { mutableIntStateOf(0) }
    suspend fun load(before: String? = null) {
        busy = true
        try {
            val next = api.transcript(user, chatId, before)
            page = if (before == null) next else next.copy(messages = (next.messages + page?.messages.orEmpty()).distinctBy { it.id ?: it })
            error = null
        } catch (e: ApiError) { error = if ((e as? ApiError.Http)?.code == "OAA_ONLY") res.getString(R.string.gp_oaa_only) else e.describe(res) }
        finally { busy = false }
    }
    LaunchedEffect(user, chatId, retry) { load() }
    BackHandler { onBack() }
    Column(Modifier.fillMaxSize()) {
        Text(stringResource(R.string.gp_read_only), color = c.violetText, fontSize = 12.sp,
            modifier = Modifier.fillMaxWidth().background(c.muted).padding(12.dp))
        TextButton(onClick = onBack) { Text(stringResource(R.string.gp_back_chats)) }
        page?.let { Text(it.chat.title ?: stringResource(R.string.gp_untitled), modifier = Modifier.padding(horizontal = 16.dp)); ChatMetadata(it.chat) }
        error?.let { Text(it, color = c.dangerText, modifier = Modifier.padding(16.dp)); TextButton(onClick = { retry++ }) { Text(stringResource(R.string.gx_try_again)) } }
        if (busy && page == null) CircularProgressIndicator(Modifier.padding(20.dp))
        val data = page
        if (data != null) {
            if (data.olderBefore != null) TextButton(enabled = !busy, onClick = { scope.launch { load(data.olderBefore) } }) { Text(stringResource(R.string.gp_earlier)) }
            if (data.messages.isEmpty()) Text(stringResource(R.string.gp_empty), modifier = Modifier.padding(16.dp))
            else Box(Modifier.weight(1f)) { GideonReadOnlyTranscript(data.messages) }
        }
    }
}
