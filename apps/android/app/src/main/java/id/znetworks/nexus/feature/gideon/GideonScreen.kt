package id.znetworks.nexus.feature.gideon

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.HeaderIconButton
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * GIDEON (dev web /gideon, Notion AI's chat page; iOS GideonPanel): every open starts a FRESH chat; the Chats
 * list (search, open, delete) sits behind the history button; answers are drawn from their markdown and the
 * tool steps read as plain words; a failure is said in the app's language with Try again.
 */
@Composable
fun GideonScreen(onBack: () -> Unit, project: Pair<String, String>? = null) {
    val context = LocalContext.current
    val chat = (context.applicationContext as NexusApplication).container.gideon
    val s by chat.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val res = context.resources
    val scope = rememberCoroutineScope()
    val indonesian = id.znetworks.nexus.core.config.ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id"
    var draft by rememberSaveable { mutableStateOf("") }
    var upload by remember { mutableStateOf<GUpload?>(null) }
    var tierMenu by remember { mutableStateOf(false) }
    var attachMenu by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var showChats by rememberSaveable { mutableStateOf(false) }
    // A fresh chat on every open (never the last one); a rotation keeps the one on screen.
    var started by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { if (!started) { started = true; chat.startNew(project) } }
    BackHandler(enabled = showChats) { showChats = false }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { scope.launch { val j = withContext(Dispatchers.IO) { AttachmentReader.uprightJpeg(context, it) }; if (j == null) note = res.getString(R.string.chat_photo_unreadable) else upload = GUpload.Image(j) } }
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { u -> scope.launch { readDoc(context, u, res)?.let { r -> r.fold({ upload = it }, { e -> note = e.message }) } } }
    }
    fun send(text: String) { chat.ask(text, upload); draft = ""; upload = null }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        val title = if (showChats) stringResource(R.string.gx_chats)
            else GideonChatTitle.text(s.chatTitle, indonesian)?.takeIf { it.isNotBlank() } ?: "GIDEON"
        val back: () -> Unit = if (showChats) ({ showChats = false }) else onBack
        PageHeader(title, onBack = back, leading = { Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText) }) {
            if (!showChats) Box {
                TextButton(onClick = { tierMenu = true }) { Text(s.tier.label, color = c.foreground) }
                DropdownMenu(tierMenu, { tierMenu = false }) {
                    GideonTier.entries.forEach { t ->
                        DropdownMenuItem(text = { Column { Text(t.label, fontWeight = FontWeight.SemiBold); Text(stringResource(tierNote(t)), fontSize = 12.sp, color = c.mutedFg) } },
                            leadingIcon = { if (t == s.tier) Icon(Icons.Filled.Check, null) }, onClick = { tierMenu = false; chat.setTier(t) })
                    }
                }
            }
            HeaderIconButton(Icons.Outlined.History, stringResource(R.string.gx_chats), { showChats = !showChats; if (showChats) chat.loadChats() })
            HeaderIconButton(Icons.Outlined.EditNote, stringResource(R.string.gx_new_chat), { showChats = false; chat.startNew(); draft = ""; upload = null }, primary = true)
        }
        // The project this chat is about (from "Ask GIDEON" on a project page), removable.
        val ctx = s.project
        if (!showChats && ctx != null) Row(Modifier.padding(start = 16.dp, top = 8.dp).clip(RoundedCornerShape(8.dp)).background(c.muted).padding(start = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(ctx.second, fontSize = 13.sp, color = c.foreground, maxLines = 1)
            IconButton(onClick = chat::dropProject, modifier = Modifier.size(32.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.mutedFg, modifier = Modifier.size(16.dp)) }
        }
        if (showChats) {
            ChatList(s, indonesian, onPick = { id -> showChats = false; chat.open(id) }, onNew = { showChats = false; chat.startNew() },
                onQuery = { q -> chat.setQuery(q) }, onSearch = { chat.loadChats() }, onRetry = { chat.loadChats() },
                onDelete = { id -> chat.deleteChat(id) { note = res.getString(R.string.gx_delete_failed) } })
            return@Column
        }
        Box(Modifier.weight(1f)) {
            when {
                s.opening -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.openFailed != null -> EmptyState(Icons.Outlined.ErrorOutline, stringResource(R.string.gx_open_failed), problemText(s.openFailed!!),
                    stringResource(R.string.gx_try_again), { s.chatId?.let(chat::open) ?: chat.startNew() }, Modifier.fillMaxSize())
                s.messages.isEmpty() && !s.thinking -> FreshChat { send(it) }
                else -> Transcript(s, indonesian)
            }
        }
        s.error?.let { p ->
            Row(Modifier.fillMaxWidth().background(c.danger.copy(alpha = 0.08f)).padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(problemText(p), fontSize = 13.sp, color = c.dangerText, modifier = Modifier.weight(1f))
                if (p.retryable) TextButton(onClick = chat::retry) { Text(stringResource(R.string.gx_try_again), color = c.dangerText, fontWeight = FontWeight.SemiBold) }
                IconButton(onClick = chat::dismissError) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.dangerText, modifier = Modifier.size(18.dp)) }
            }
        }
        upload?.let { u ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("📎 " + when (u) { is GUpload.Image -> stringResource(R.string.gd_image_attached); is GUpload.Document -> u.name }, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                IconButton(onClick = { upload = null }) { Icon(Icons.Filled.Close, stringResource(R.string.cancel)) }
            }
        }
        Box(Modifier.fillMaxWidth().background(c.border).padding(top = 1.dp)) {
            Row(Modifier.fillMaxWidth().background(c.card).padding(8.dp), verticalAlignment = Alignment.Bottom) {
                Box {
                    IconButton(onClick = { attachMenu = true }) { Icon(Icons.Filled.Add, stringResource(R.string.chat_attach), tint = c.mutedFg) }
                    DropdownMenu(attachMenu, { attachMenu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, onClick = { attachMenu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.files)) }, onClick = { attachMenu = false; files.launch(arrayOf("*/*")) })
                    }
                }
                OutlinedTextField(draft, { draft = it }, placeholder = { Text(stringResource(R.string.gx_placeholder)) }, maxLines = 6,
                    shape = RoundedCornerShape(20.dp), modifier = Modifier.weight(1f))
                IconButton(onClick = { send(draft) }, enabled = !s.thinking && (draft.isNotBlank() || upload != null)) {
                    Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = if (!s.thinking && (draft.isNotBlank() || upload != null)) c.foreground else c.mutedFg)
                }
            }
        }
    }
    note?.let { AlertDialog(onDismissRequest = { note = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { note = null }) { Text("OK") } }) }
}

/** A new chat: the calm empty state, its action the first suggestion, two more under it. */
@Composable
private fun FreshChat(onAsk: (String) -> Unit) {
    val c = Nx.colors
    val chips = listOf(stringResource(R.string.gx_chip_overdue), stringResource(R.string.gx_chip_week), stringResource(R.string.gx_chip_decide))
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        EmptyState(Icons.Filled.AutoAwesome, stringResource(R.string.gx_empty_title), stringResource(R.string.gx_empty_sub), chips[0], { onAsk(chips[0]) })
        chips.drop(1).forEach { q ->
            Text(q, fontSize = 14.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 32.dp, vertical = 4.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp))
                    .clickable { onAsk(q) }.defaultMinSize(minHeight = 44.dp).padding(horizontal = 14.dp, vertical = 11.dp))
        }
    }
}

@Composable
private fun Transcript(s: GideonChat.State, indonesian: Boolean) {
    val c = Nx.colors
    val list = rememberLazyListState()
    LaunchedEffect(s.messages.size, s.thinking) { if (s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.size) }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items(s.messages.withIndex().toList(), key = { it.index }) { (_, m) ->
            if (m.role == "user") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Column(Modifier.widthIn(max = 320.dp).background(c.muted, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 9.dp)) {
                    m.attachments.forEach { a -> Text("📎 " + (a.name?.takeIf { it.isNotBlank() && it != "image" } ?: stringResource(R.string.gd_image_attached)), fontSize = 12.sp, color = c.mutedFg) }
                    SelectionContainer { Text(m.content, fontSize = 15.sp, lineHeight = 21.sp, color = c.foreground) }
                }
            } else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                m.steps.forEach { st -> StepLine(st) }
                SelectionContainer { GideonMarkdownText(m.content, c.foreground) }
            }
        }
        if (s.thinking) item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.gx_working), fontSize = 13.sp, color = c.mutedFg)
            }
        }
    }
}

@Composable
private fun StepLine(st: GStep) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (st.status == "error") "!" else "✓", fontSize = 12.sp, color = if (st.status == "error") c.dangerText else c.mutedFg, modifier = Modifier.width(16.dp))
        Text(stepText(st), fontSize = 13.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A step in the app's language; never a raw tool name. */
@Composable
fun stepText(st: GStep): String {
    val t = GideonSteps.text(st)
    val a = t.arg
    @Composable fun pick(plain: Int, named: Int) = if (a != null) stringResource(named, a) else stringResource(plain)
    return when (t.kind) {
        GideonSteps.Kind.LIST_PROJECTS -> stringResource(R.string.gx_step_list_projects)
        GideonSteps.Kind.LOOKUP_PEOPLE -> stringResource(R.string.gx_step_people)
        GideonSteps.Kind.LIST_TASKS -> pick(R.string.gx_step_list_tasks, R.string.gx_step_list_tasks_in)
        GideonSteps.Kind.SEARCH_TASKS -> pick(R.string.gx_step_search_tasks, R.string.gx_step_search_tasks_q)
        GideonSteps.Kind.SEARCH_WORKSPACE -> pick(R.string.gx_step_search_ws, R.string.gx_step_search_ws_q)
        GideonSteps.Kind.READ_PROJECT -> pick(R.string.gx_step_read_project, R.string.gx_step_read_project_n)
        GideonSteps.Kind.READ_NAMED -> pick(R.string.gx_step_read_project, R.string.gx_step_read_named)
        GideonSteps.Kind.READ_FIELDS -> stringResource(R.string.gx_step_fields)
        GideonSteps.Kind.READ_TASK -> pick(R.string.gx_step_read_task, R.string.gx_step_read_task_n)
        GideonSteps.Kind.SEARCH_DOCS -> pick(R.string.gx_step_search_docs, R.string.gx_step_search_docs_q)
        GideonSteps.Kind.READ_DOC -> pick(R.string.gx_step_read_doc, R.string.gx_step_read_doc_n)
        GideonSteps.Kind.CREATE_TASK -> pick(R.string.gx_step_create_task, R.string.gx_step_create_task_n)
        GideonSteps.Kind.UPDATE_TASK -> pick(R.string.gx_step_update_task, R.string.gx_step_update_task_n)
        GideonSteps.Kind.COMMENT -> pick(R.string.gx_step_comment, R.string.gx_step_comment_n)
        GideonSteps.Kind.WRITE_DOC -> pick(R.string.gx_step_write_doc, R.string.gx_step_write_doc_n)
        GideonSteps.Kind.LOOK_IMAGE -> stringResource(R.string.gx_step_image)
        GideonSteps.Kind.LABEL -> a.orEmpty()
        GideonSteps.Kind.WORKING -> stringResource(R.string.gx_working)
    }
}

/** A failure in the app's language. */
@Composable
fun problemText(p: GideonProblem): String = when (p.kind) {
    GideonProblem.Kind.UNREACHABLE -> stringResource(R.string.gx_unreachable)
    GideonProblem.Kind.BUSY -> stringResource(R.string.gx_busy)
    GideonProblem.Kind.NOT_CONNECTED -> stringResource(R.string.gx_not_connected)
    GideonProblem.Kind.NO_ANSWER -> stringResource(R.string.gx_no_answer)
    GideonProblem.Kind.TOO_LARGE -> stringResource(R.string.gx_too_large)
    GideonProblem.Kind.UNSUPPORTED -> stringResource(R.string.gx_unsupported)
    GideonProblem.Kind.RATE_LIMITED -> stringResource(R.string.gx_rate_limited)
    GideonProblem.Kind.NO_DOCUMENTS -> stringResource(R.string.gx_no_documents)
    GideonProblem.Kind.COULDNT_ANSWER -> stringResource(R.string.gx_couldnt_answer)
    GideonProblem.Kind.FAILED -> stringResource(R.string.gx_failed)
    GideonProblem.Kind.OTHER -> p.raw ?: stringResource(R.string.gx_failed)
}

/** Chats: search, grouped by last activity, open one, delete one (centred confirm), start new. */
@Composable
private fun ChatList(s: GideonChat.State, indonesian: Boolean, onPick: (String) -> Unit, onNew: () -> Unit, onQuery: (String) -> Unit,
                     onSearch: () -> Unit, onRetry: () -> Unit, onDelete: (String) -> Unit) {
    val c = Nx.colors
    var deleting by remember { mutableStateOf<GChatRow?>(null) }
    // Search as you type, 300 ms after the last key.
    LaunchedEffect(s.query) { delay(300); onSearch() }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, c.border, RoundedCornerShape(10.dp)).background(c.card).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Search, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
            androidx.compose.foundation.text.BasicTextField(s.query, onQuery, singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, color = c.foreground),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(c.foreground),
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 12.dp),
                decorationBox = { inner -> if (s.query.isEmpty()) Text(stringResource(R.string.gx_search_chats), fontSize = 15.sp, color = c.mutedFg); inner() })
            if (s.query.isNotEmpty()) IconButton(onClick = { onQuery("") }, modifier = Modifier.size(32.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.mutedFg, modifier = Modifier.size(16.dp)) }
        }
        val rows = s.chats
        when {
            rows == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s.chatsError != null && rows.isEmpty() -> EmptyState(Icons.Outlined.ErrorOutline, stringResource(R.string.gx_chats_failed), problemText(s.chatsError),
                stringResource(R.string.gx_try_again), onRetry, Modifier.fillMaxSize())
            rows.isEmpty() -> EmptyState(Icons.Outlined.Forum, stringResource(R.string.gx_chats),
                if (s.query.isNotBlank()) stringResource(R.string.gx_no_match, s.query.trim()) else stringResource(R.string.gx_no_chats),
                stringResource(R.string.gx_new_chat), onNew, Modifier.fillMaxSize())
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 24.dp)) {
                GideonChatGroups.group(rows, OfficeTime.today()).forEach { (bucket, items) ->
                    item(key = "g-$bucket") {
                        Text(stringResource(when (bucket) {
                            GideonChatGroups.Bucket.TODAY -> R.string.gx_today; GideonChatGroups.Bucket.YESTERDAY -> R.string.gx_yesterday
                            GideonChatGroups.Bucket.WEEK -> R.string.gx_week; GideonChatGroups.Bucket.OLDER -> R.string.gx_older
                        }), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, modifier = Modifier.padding(start = 10.dp, top = 12.dp, bottom = 4.dp))
                    }
                    items(items, key = { it.id }) { r ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (r.id == s.chatId) c.accentBg else c.background)
                            .clickable { onPick(r.id) }.defaultMinSize(minHeight = 48.dp).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                                Text(GideonChatTitle.text(r.title, indonesian)?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_untitled),
                                    fontSize = 15.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                r.match?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                            }
                            IconButton(onClick = { deleting = r }) { Icon(Icons.Outlined.Delete, stringResource(R.string.gx_delete), tint = c.mutedFg, modifier = Modifier.size(18.dp)) }
                        }
                    }
                }
            }
        }
    }
    deleting?.let { r ->
        AlertDialog(onDismissRequest = { deleting = null }, title = { Text(stringResource(R.string.gx_delete_q)) },
            text = { Text((r.title?.let { "“$it”. " } ?: "") + stringResource(R.string.gx_delete_body)) },
            confirmButton = { TextButton(onClick = { deleting = null; onDelete(r.id) }) { Text(stringResource(R.string.delete), color = c.dangerText) } },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

private fun tierNote(t: GideonTier) = when (t) {
    GideonTier.ASTRA -> R.string.gd_astra; GideonTier.LUNA -> R.string.gd_luna; GideonTier.TERRA -> R.string.gd_terra; GideonTier.EXPERIMENTAL -> R.string.gd_experimental
}

/** A document for GIDEON: a known extension and ≤ 10 MB, read whole (it goes as base64). */
private suspend fun readDoc(context: android.content.Context, uri: Uri, res: android.content.res.Resources): Result<GUpload>? = withContext(Dispatchers.IO) {
    val cr = context.contentResolver
    var name = "file"; var size = -1L
    runCatching { cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) { if (!c.isNull(0)) name = c.getString(0); if (!c.isNull(1)) size = c.getLong(1) } } }
    when {
        !GideonRules.acceptsDocument(name) -> Result.failure(Exception(res.getString(R.string.gx_unsupported)))
        size > GideonRules.MAX_DOC -> Result.failure(Exception(res.getString(R.string.gx_too_large)))
        else -> runCatching { cr.openInputStream(uri)!!.use { it.readBytes() } }.fold(
            { b -> if (b.size > GideonRules.MAX_DOC) Result.failure(Exception(res.getString(R.string.gx_too_large))) else Result.success(GUpload.Document(name, cr.getType(uri) ?: "application/octet-stream", b)) },
            { Result.failure(Exception(res.getString(R.string.gd_unreadable))) })
    }
}
