package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import android.net.Uri
import androidx.compose.animation.core.*
import androidx.compose.ui.draw.alpha
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
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Mic
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
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
    val container = (context.applicationContext as NexusApplication).container
    val chat = container.gideon
    val s by chat.state.collectAsStateWithLifecycle()
    val tiers by container.gideonTiers.state.collectAsStateWithLifecycle()
    val config by container.remoteConfig.body.collectAsStateWithLifecycle()
    LaunchedEffect(s.error?.kind) { if (s.error?.kind == GideonProblem.Kind.TIER_UNAVAILABLE) container.gideonTiers.refresh() }
    LaunchedEffect(Unit) { container.gideonTiers.seed(container.remoteConfig.current.gideonTiers); container.gideonTiers.refresh() }
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
    // "Review before writing" is remembered on the device (iOS @AppStorage "gideon.approval", web localStorage).
    val prefs = remember { context.getSharedPreferences(GIDEON_PREFS, android.content.Context.MODE_PRIVATE) }
    val reviewNoticeKey = "review-notice-bod-v1:" + container.sessionStore.current?.userId.orEmpty()
    var showReviewNotice by remember(reviewNoticeKey) { mutableStateOf(!prefs.getBoolean(reviewNoticeKey, false)) }
    LaunchedEffect(Unit) { chat.setApproval(GideonApprovalMode.of(prefs.getString(KEY_APPROVAL, null))) }
    var decision by remember { mutableStateOf<GDecision?>(null) }
    val focus = remember { FocusRequester() }
    BackHandler(enabled = showChats) { showChats = false }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { scope.launch { val j = withContext(Dispatchers.IO) { AttachmentReader.uprightJpeg(context, it) }; if (j == null) note = res.getString(R.string.chat_photo_unreadable) else upload = GUpload.Image(j) } }
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { u -> scope.launch { readDoc(context, u, res)?.let { r -> r.fold({ upload = it }, { e -> note = e.message }) } } }
    }
    fun send(text: String) { if (tiers.available(s.tier)) { chat.ask(text, upload); draft = ""; upload = null } }

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
        val title = if (showChats) stringResource(R.string.gx_chats)
            else GideonChatTitle.text(s.chatTitle, indonesian)?.takeIf { it.isNotBlank() } ?: "GIDEON"
        val back: () -> Unit = if (showChats) ({ showChats = false }) else onBack
        PageHeader(if (showChats) title else "$title ⌄", onBack = back, onTitleClick = { showChats = !showChats; if (showChats) chat.loadChats() }, leading = { id.znetworks.nexus.ui.components.GideonMark(22.dp, c.foreground) }) {
            HeaderIconButton(Icons.Outlined.History, stringResource(R.string.gx_chats), { showChats = !showChats; if (showChats) chat.loadChats() })
            HeaderIconButton(Icons.Outlined.EditNote, stringResource(R.string.gx_new_chat), { showChats = false; chat.startNew(); draft = ""; upload = null }, primary = true)
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
                s.messages.isEmpty() && s.pending.isEmpty() && !s.thinking -> FreshChat { send(it) }
                else -> Transcript(s, indonesian, loadRooms = { a, b, x -> chat.roomAvailability(a, b, x) }) { d -> decision = d }
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
        // Above the composer: the @ picker while the draft ends in "@…", then the context chips (web / iOS).
        GideonMention.query(draft)?.let { q ->
            MentionPicker(q, container.api) { ref -> chat.addRef(ref); draft = GideonMention.strip(draft); runCatching { focus.requestFocus() } }
        }
        ContextChips(s.project, s.refs, onDropProject = chat::dropProject, onRemove = chat::removeRef)
        GideonCreditMeter(container.api, s.thinking)
        if (!tiers.available(s.tier)) Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.g19_notice, s.tier.label), color = c.warningFg, fontSize = 12.sp)
                Text(stringResource(when (tiers.tiers[s.tier.key]?.reason) { "transcribing" -> R.string.g19_transcribing; "loading" -> R.string.g19_loading; else -> R.string.g19_down }), color = c.mutedFg, fontSize = 11.sp)
            }
            TextButton(onClick = { chat.setTier(GideonTier.LUNA) }) { Text(stringResource(R.string.g19_use_phaethon)) }
        }
        // The composer card (iOS / web): the field, then + · "Review before writing ▾" · send.
        Box(Modifier.fillMaxWidth().background(c.border).padding(top = 1.dp)) {
            Column(Modifier.fillMaxWidth().background(c.card).padding(horizontal = 8.dp, vertical = 6.dp)) {
                androidx.compose.material3.TextField(draft, { draft = it }, colors = androidx.compose.material3.TextFieldDefaults.colors(focusedContainerColor = c.card, unfocusedContainerColor = c.card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent), placeholder = { Text(stringResource(R.string.gx_placeholder)) }, maxLines = 6,
                    shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().focusRequester(focus))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        IconButton(onClick = { attachMenu = true }) { Icon(Icons.Filled.Add, stringResource(R.string.chat_attach), tint = c.mutedFg) }
                        DropdownMenu(attachMenu, { attachMenu = false }) {
                            if (config.meetingNotesEnabled) DropdownMenuItem(text = { Column {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Text(stringResource(R.string.meet_recording_entry)); id.znetworks.nexus.feature.meetings.MeetingBeta() }
                                Text(stringResource(R.string.meet_entry_hint), color = c.mutedFg, fontSize = 11.sp)
                            } }, leadingIcon = { Icon(Icons.Outlined.Mic, null) }, onClick = { attachMenu = false; container.router.open(id.znetworks.nexus.core.nav.Target.NewMeeting(s.project?.first)) })
                            if (config.meetingNotesEnabled) DropdownMenuItem(text = { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Text(stringResource(R.string.meet_title)); id.znetworks.nexus.feature.meetings.MeetingBeta() } }, onClick = { attachMenu = false; container.router.open(id.znetworks.nexus.core.nav.Target.Meetings(s.project?.first)) })
                            DropdownMenuItem(text = { Text(stringResource(R.string.gallery)) }, onClick = { attachMenu = false; gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                            DropdownMenuItem(text = { Text(stringResource(R.string.files)) }, onClick = { attachMenu = false; files.launch(arrayOf("*/*")) })
                            // "Add a page, task or project": starts an "@" at the end of the draft (web startMention).
                            DropdownMenuItem(text = { Text(stringResource(R.string.gx_add_page)) }, leadingIcon = { Icon(Icons.Filled.AlternateEmail, null) },
                                onClick = { attachMenu = false; draft = GideonMention.start(draft); scope.launch { delay(50); runCatching { focus.requestFocus() } } })
                        }
                    }
                    Box(Modifier.weight(1f)) { ApprovalMenu(s.approval) { m -> chat.setApproval(m); prefs.edit().putString(KEY_APPROVAL, m.key).apply() } }
                    Box {
                TextButton(onClick = { tierMenu = true }) { Text(s.tier.label + " ⌄", fontSize = 12.sp, color = c.foreground) }
                DropdownMenu(tierMenu, { tierMenu = false }, shape = RoundedCornerShape(16.dp), containerColor = c.card, border = androidx.compose.foundation.BorderStroke(1.dp, c.border)) {
                    GideonTier.entries.forEach { t ->
                        DropdownMenuItem(modifier = Modifier.heightIn(min = 72.dp), enabled = tiers.available(t), text = { Column {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(t.label, fontWeight = FontWeight.SemiBold)
                                if (t == GideonTier.LUNA || t == GideonTier.EXPERIMENTAL) Text(stringResource(if (t == GideonTier.LUNA) R.string.g19_default else R.string.g19_experimental), fontSize = 10.sp,
                                    color = if (t == GideonTier.EXPERIMENTAL) c.warningFg else c.mutedFg,
                                    modifier = Modifier.background(if (t == GideonTier.EXPERIMENTAL) c.warning.copy(alpha = 0.12f) else c.muted, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp))
                            }
                            if (!tiers.available(t)) {
                                Text(stringResource(R.string.g19_unavailable), fontSize = 12.sp, color = c.mutedFg)
                                Text(stringResource(when (tiers.tiers[t.key]?.reason) { "transcribing" -> R.string.g19_transcribing; "loading" -> R.string.g19_loading; else -> R.string.g19_down }), fontSize = 11.sp, color = c.mutedFg)
                            }
                        } },
                            leadingIcon = { if (t == s.tier) Icon(Icons.Filled.Check, null) else Spacer(Modifier.size(24.dp)) }, onClick = { tierMenu = false; chat.setTier(t) })
                    }
                }
            }

                    if (s.thinking) TextButton(onClick = chat::stop) { Text(stringResource(R.string.gc_stop), color = c.foreground) }
                    else IconButton(onClick = { send(draft) }, modifier = Modifier.background(if (tiers.available(s.tier) && (draft.isNotBlank() || upload != null)) c.onyx else c.muted, androidx.compose.foundation.shape.CircleShape), enabled = tiers.available(s.tier) && (draft.isNotBlank() || upload != null)) {
                        Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.td_send), tint = if (!s.thinking && (draft.isNotBlank() || upload != null)) c.background else c.mutedFg)
                    }
                }
            }
        }
        Text(stringResource(R.string.gc_ai_disclaimer), fontSize = 11.sp, color = c.mutedFg,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp))
    }
    if (showReviewNotice) AlertDialog(onDismissRequest = {
        prefs.edit().putBoolean(reviewNoticeKey, true).apply(); showReviewNotice = false
    }, text = { Text(stringResource(R.string.gc_review_notice)) }, confirmButton = {
        TextButton(onClick = { prefs.edit().putBoolean(reviewNoticeKey, true).apply(); showReviewNotice = false }) { Text("OK") }
    })
    decision?.let { d -> DecisionDialog(d.proposal, d.apply, onConfirm = { chat.decide(d.proposal, d.apply, d.booking, d.task) }, onDismiss = { decision = null }) }
    note?.let { AlertDialog(onDismissRequest = { note = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { note = null }) { Text("OK") } }) }
}

/**
 * A new chat like iOS GideonEmptyPrompt / the web: the mark in a rounded tile, "What can GIDEON do for you?", what it
 * reads, and three suggestions as equal outlined rows asked with one tap.
 */
@Composable
private fun FreshChat(onAsk: (String) -> Unit) {
    val c = Nx.colors
    val chips = listOf(stringResource(R.string.gx_chip_calendar), stringResource(R.string.gx_chip_overdue), stringResource(R.string.gx_chip_week), stringResource(R.string.gx_chip_decide))
    Column(Modifier.fillMaxSize().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(c.background).border(1.dp, c.border, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center) { id.znetworks.nexus.ui.components.GideonMark(24.dp, c.foreground.copy(alpha = 0.8f)) }
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.gx_empty_title, "GIDEON"), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.foreground,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.gx_empty_sub), fontSize = 13.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        chips.forEach { q ->
            Text(q, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground,
                modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(12.dp)).background(c.background)
                    .border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { onAsk(q) }.defaultMinSize(minHeight = 44.dp)
                    .padding(horizontal = 14.dp, vertical = 10.dp))
        }
    }
}

@Composable
private fun Transcript(s: GideonChat.State, indonesian: Boolean, loadRooms: suspend (String, String, String?) -> GRoomAvailability?, readOnly: Boolean = false, onDecide: (GDecision) -> Unit) {
    val c = Nx.colors
    val list = rememberLazyListState()
    LaunchedEffect(s.messages.size, s.thinking) { if (!readOnly && s.messages.isNotEmpty()) list.animateScrollToItem(s.messages.size) }
    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val transcriptIds = s.messages.flatMap { it.proposals }.map { it.id }.toSet()
        items(s.pending.filter { it.id !in transcriptIds }, key = { "pending:${it.id}" }) { p ->
            when {
                p.action == "create_task" && p.taskTarget != null && p.isPending -> CreateTaskCard(p, p.id in s.deciding, onDecide)
                p.action == "delete_task" || p.extra != null -> ActionCard(p, p.id in s.deciding, onDecide)
                else -> ProposalCard(p, p.id in s.deciding) { onDecide(GDecision(p, it)) }
            }
        }
        items(s.messages.withIndex().toList(), key = { it.index }) { (_, m) ->
            if (readOnly) m.createdAt?.let { Text(id.znetworks.nexus.feature.chat.chatTime(it), fontSize = 11.sp, color = c.mutedFg) }
            if (m.role == "user") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Column(Modifier.widthIn(max = 320.dp).background(c.muted, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 9.dp)) {
                    m.attachments.forEach { a -> Text("📎 " + (a.name?.takeIf { it.isNotBlank() && it != "image" } ?: stringResource(R.string.gd_image_attached)), fontSize = 12.sp, color = c.mutedFg) }
                    SelectionContainer { Text(m.content, fontSize = 15.sp, lineHeight = 21.sp, color = c.foreground) }
                }
            } else Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (m.steps.isNotEmpty()) {
                    var expanded by remember { mutableStateOf(false) }
                    Text(if (m.steps.any { it.status == "running" }) stringResource(R.string.gc_thinking) else androidx.compose.ui.res.pluralStringResource(R.plurals.gc_step_count, m.steps.size, m.steps.size), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.clickable { expanded = !expanded })
                    if (expanded) m.steps.forEach { st -> StepLine(st) }
                }
                if (m.content.isNotBlank()) SelectionContainer { GideonMarkdownText(m.content, c.foreground) }
                // Review before writing: the changes waiting for Apply, then what GIDEON made directly.
                m.proposals.forEach { p ->
                    val b = p.booking
                    // A room booking has its own card with the room picker; every other change is a diff.
                    val change = p.bookingChange
                    if (readOnly) {
                        if (p.action == "delete_task" || p.extra != null) ActionCard(p, false, {}, readOnly = true)
                        else ProposalCard(p, deciding = false, readOnly = true) {}
                        b?.let { Text(listOfNotNull(it.room, it.startsAt, it.endsAt).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg) }
                        change?.let { Text(listOfNotNull(it.before.room, it.before.startsAt, it.after?.room, it.after?.startsAt).joinToString(" → "), fontSize = 12.sp, color = c.mutedFg) }
                    }
                    else if (p.action == "book_room" && b != null) BookRoomCard(p, b, deciding = p.id in s.deciding, loadRooms = { x, y -> loadRooms(x, y, null) },
                        onApply = { choice -> onDecide(GDecision(p, true, choice)) }, onDiscard = { onDecide(GDecision(p, false)) })
                    // Moving / cancelling one (16 Oct 2026): the booking before and after.
                    else if ((p.action == "move_room_booking" || p.action == "cancel_room_booking") && change != null)
                        BookingChangeCard(p, change, deciding = p.id in s.deciding, loadRooms = loadRooms,
                            onApply = { choice -> onDecide(GDecision(p, true, choice)) }, onDiscard = { onDecide(GDecision(p, false)) })
                    else if (p.action == "create_task" && p.taskTarget != null && p.isPending) CreateTaskCard(p, p.id in s.deciding, onDecide)
                    else if (p.action == "delete_task" || p.extra != null) ActionCard(p, p.id in s.deciding, onDecide)
                    else ProposalCard(p, deciding = p.id in s.deciding) { apply -> onDecide(GDecision(p, apply)) }
                }
                m.cards.forEach { card -> ResultCard(card) }
                if (readOnly && m.credits != null) Text((GideonTier.entries.firstOrNull { it.key == m.tier }?.label ?: "GIDEON") + " · " +
                    stringResource(R.string.gp_credits_count, m.credits), fontSize = 11.sp, color = c.mutedFg)
            }
        }
        if (s.thinking) item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp))
                ThinkingLine()
            }
        }
    }
}

/** Shares the normal rendering but has no composer, mutations, approval controls or room requests. */
@Composable
internal fun GideonReadOnlyTranscript(messages: List<GMessage>) {
    Transcript(GideonChat.State(messages = messages), false, loadRooms = { _, _, _ -> null }, readOnly = true) {}
}

@Composable
private fun ThinkingLine() {
    val transition = rememberInfiniteTransition(label = "thinking")
    val alpha by transition.animateFloat(0.4f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "thinkingAlpha")
    Text(stringResource(R.string.gc_thinking), fontSize = 13.sp, color = Nx.colors.mutedFg, modifier = Modifier.alpha(alpha))
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
        GideonSteps.Kind.PERSON_STATUS -> if (a != null) stringResource(R.string.prs_step_get, a) else st.label.orEmpty()
        GideonSteps.Kind.MY_STATUS -> if (a != null) stringResource(R.string.prs_step_set, a) else st.label.orEmpty()
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
        GideonSteps.Kind.READ_CALENDAR -> pick(R.string.gx_step_calendar, R.string.gx_step_calendar_n)
        GideonSteps.Kind.ROOM_BOOKINGS -> pick(R.string.gx_step_rooms, R.string.gx_step_rooms_n)
        GideonSteps.Kind.BOOK_ROOM -> pick(R.string.gx_step_book_room, R.string.gx_step_book_room_n)
        GideonSteps.Kind.MOVE_BOOKING -> pick(R.string.gx_step_move_booking, R.string.gx_step_move_booking_n)
        GideonSteps.Kind.CANCEL_BOOKING -> pick(R.string.gx_step_cancel_booking, R.string.gx_step_cancel_booking_n)
        GideonSteps.Kind.LOOK_IMAGE -> stringResource(R.string.gx_step_image)
        GideonSteps.Kind.LABEL -> a.orEmpty()
        GideonSteps.Kind.WORKING -> stringResource(R.string.gx_working)
    }
}

/** A failure in the app's language. */
@Composable
fun problemText(p: GideonProblem): String = when (p.kind) {
    GideonProblem.Kind.TIER_UNAVAILABLE -> stringResource(R.string.g19_unavailable)
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
            if (s.query.isNotEmpty()) IconButton(onClick = { onQuery("") }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.mutedFg, modifier = Modifier.size(16.dp)) }
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

private const val GIDEON_PREFS = "gideon"
private const val KEY_APPROVAL = "approval"

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
