package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.ui.components.NxSwitch

import id.znetworks.nexus.ui.components.NxCheckbox

import id.znetworks.nexus.ui.components.NxTextField

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.ui.draw.clip
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.Lifecycle
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.material.icons.filled.NotificationsOff
import android.app.Application
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.RosterMember
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class MessagesState(
    val conversations: List<Conversation> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val savedAt: Long? = null,
    val roster: List<RosterMember> = emptyList(),
    val busy: Boolean = false,
)

class MessagesViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = ChatApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(MessagesState())
    val state = _state.asStateFlow()
    val meId: String? get() = c.sessionStore.current?.userId

    // Polled by the screen only while it is visible and the app in front (CHAT-REPORT: no background polling).
    /** Every [ChatApi.LIST_POLL_MS], and at once on resume or when a chat push arrives. */
    fun drop(conversationId: String?) { if (conversationId != null) _state.update { s -> s.copy(conversations = s.conversations.filterNot { it.id == conversationId }) } }

    suspend fun pollWhileVisible() {
        // Pings (conversation-updated) arrive through chatEvents; the poll is the fallback (owner, 8 Oct).
        while (true) { load(); delay(id.znetworks.nexus.core.realtime.RealtimeEvents.interval(c.realtime.connected, ChatApi.LIST_POLL_LIVE_MS, ChatApi.LIST_POLL_MS)) }
    }

    suspend fun load() {
        try {
            val r = api.conversations()
            _state.update { it.copy(conversations = r.value.conversations, savedAt = r.savedAtMillis, loading = false, error = null) }
            // Project rooms draw their project's mark (iOS): read the project list once if nobody has yet.
            if (id.znetworks.nexus.feature.projects.ProjectIcons.icons.value.isEmpty() && r.value.conversations.any { it.projectId != null })
                runCatching { id.znetworks.nexus.feature.projects.ProjectsApi(c.api).projects() }
            if (r.savedAtMillis == null) c.badges.setChat(r.value.unread())
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = if (it.conversations.isEmpty()) e.describe(res) else null) }
        }
    }

    fun refresh() = viewModelScope.launch { load() }

    fun loadRoster() = viewModelScope.launch {
        if (_state.value.roster.isNotEmpty()) return@launch
        runCatching { ProjectsApi(c.api).roster().members }.getOrNull()?.let { l -> _state.update { it.copy(roster = l) } }
    }

    fun create(userIds: List<String>, groupName: String?, makeGroup: Boolean, onOpen: (String) -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true) }
        try {
            val type = ChatRules.newChatType(userIds.size, makeGroup)
            // The name only for a group.
            val conv = api.create(type, userIds, groupName.takeIf { type == "GROUP" })
            load(); onOpen(conv.id)
        } catch (e: ApiError) { _state.update { it.copy(error = e.describe(res)) } }
        _state.update { it.copy(busy = false) }
    }
}

internal fun chatTime(iso: String?): String {
    val t = iso?.let { runCatching { Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta")) }.getOrNull() } ?: return ""
    val today = java.time.LocalDate.now(ZoneId.of("Asia/Jakarta"))
    return if (t.toLocalDate() == today) DateTimeFormatter.ofPattern("HH:mm").format(t)
    else AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(t)
}

@Composable
fun MessagesScreen(onBack: (() -> Unit)?, onOpenChat: (String) -> Unit, vm: MessagesViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var composing by remember { mutableStateOf(false) }
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val typingRooms by container.typing.rooms.collectAsStateWithLifecycle()
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { container.chatEvents.collect { vm.load() } }
            // A group deleted: off the list at once, then the fresh list (DELETE-GROUP).
            launch { container.realtime.events.collect { e -> if (id.znetworks.nexus.core.realtime.RealtimeEvents.groupDeleted(e)) { vm.drop(e.conversationId); vm.load() } } }
            vm.pollWhileVisible()
        }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        // A tab now: no back arrow there (null); kept for a pushed copy.
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.chat_title), subtitle = stringResource(R.string.sub_messages), onBack = onBack) {
            id.znetworks.nexus.ui.components.HeaderIconButton(Icons.Filled.Edit, stringResource(R.string.chat_new), { vm.loadRoster(); composing = true }, primary = true)
        }
        s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp)) }
        MessagesPager(s, vm.meId, typingRooms.filterValues { it.isNotEmpty() }.keys, vm::refresh, { vm.loadRoster(); composing = true }, onOpenChat, Modifier.weight(1f))
    }

    if (composing) NewChatDialog(s, vm.meId, onDismiss = { composing = false }) { ids, name, group ->
        composing = false; vm.create(ids, name, group, onOpenChat)
    }
}

@Composable
internal fun ConversationRow(conv: Conversation, meId: String?, typing: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    val dmFallback = stringResource(R.string.chat_direct_message)
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        when (conv.type) {
            // The other person's photo, else the web's two-letter initials of the title ("BZ", "DM"), never "?".
            "DM" -> Avatar(conv.title(meId, dmFallback), conv.other(meId)?.avatar, 44.dp, initials = conv.initials(meId, dmFallback), userId = conv.other(meId)?.id)
            // A project room shows its project's mark (photo or the page icon), like iOS; a group keeps the group icon.
            "PROJECT" -> {
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                    id.znetworks.nexus.feature.projects.ProjectMark(null, 30.dp, projectId = conv.projectId)
                }
            }
            else -> Box(Modifier.size(44.dp).background(c.violet.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(if (conv.type == "PROJECT") Icons.Filled.ViewKanban else Icons.Filled.Groups, null, tint = c.violetText)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Title (+ bell-off) takes the room; the time stays at the end of the row.
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(conv.title(meId, dmFallback), fontSize = 15.sp, fontWeight = if (conv.unreadCount > 0) FontWeight.Bold else FontWeight.SemiBold,
                        color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (conv.muted()) Icon(Icons.Filled.NotificationsOff, stringResource(R.string.chat_muted), tint = c.mutedFg, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text(chatTime(conv.lastMessage?.createdAt), fontSize = 11.sp, color = if (conv.unreadCount > 0) c.violetText else c.mutedFg)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val last = conv.lastMessage
                val preview = when {
                    last == null -> stringResource(R.string.chat_no_message)
                    last.attachmentUrl != null && !last.isImage -> ChatDocuments.preview(last.attachmentType, last.attachmentName, stringResource(R.string.files)) ?: stringResource(R.string.files)
                    last.content.isBlank() && last.attachmentUrl != null -> "📷 " + stringResource(R.string.chat_photo)
                    last.isSystem -> ChatSystemText.sentence(last.event, last.content, meId, ChatSystemText.Words.of(LocalContext.current.resources))
                    else -> when (val p = ChatPayload.parse(last.content)) {
                        is ChatPayload.Location -> "📍 " + stringResource(R.string.chat_location)
                        is ChatPayload.Task -> "📋 " + p.title
                        ChatPayload.Plain -> last.content
                    }
                }
                // A log line reads as its own sentence, not "Budi: Budi Santoso menambahkan …" (SYSTEM-MESSAGES).
                val who = if (conv.type != "DM" && last?.user?.name != null && !last.isSystem) "${last.user.name.substringBefore(' ')}: " else ""
                // "typing…" in place of the last message while anyone types in that room (TYPING.md).
                if (typing) Text(stringResource(R.string.ty_typing), fontSize = 13.sp, color = c.violetText, maxLines = 1, modifier = Modifier.weight(1f))
                else Text(who + preview, fontSize = 13.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                // A muted conversation still counts its unread, quietly (grey).
                if (conv.unreadCount > 0) Text("${conv.unreadCount}", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = if (conv.muted()) c.background else androidx.compose.ui.graphics.Color.White,
                    modifier = Modifier.background(if (conv.muted()) c.mutedFg else c.danger, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
            }
        }
    }
    HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 72.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewChatDialog(s: MessagesState, meId: String?, onDismiss: () -> Unit, onCreate: (List<String>, String?, Boolean) -> Unit) {
    val c = Nx.colors
    var q by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf(listOf<RosterMember>()) }
    var groupName by rememberSaveable { mutableStateOf("") }
    var makeGroup by rememberSaveable { mutableStateOf(false) }
    val people = s.roster.filter { (it.userId ?: it.id) != meId }
        .filter { m -> q.isBlank() || listOfNotNull(m.name, m.email).any { it.contains(q.trim(), true) } }
        .sortedBy { it.name.orEmpty().lowercase() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_new)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (picked.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    picked.forEach { m -> FilterChip(true, { picked = picked - m }, { Text("${m.name ?: m.email} ✕", fontSize = 12.sp) }) }
                }
                // "Make it a group" (NAV-HOME-GROUP): a group with one other person; two or more always are one.
                val forced = picked.size >= 2
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Groups, null, tint = c.violetText); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.ng_make_group), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(stringResource(if (forced) R.string.ng_forced else R.string.ng_one_other), fontSize = 11.sp, color = c.mutedFg)
                    }
                    NxSwitch(forced || makeGroup, { makeGroup = it }, enabled = !forced)
                }
                if (forced || makeGroup) NxTextField(groupName, { groupName = it }, singleLine = true, label = { Text(stringResource(R.string.chat_group_name)) }, modifier = Modifier.fillMaxWidth())
                NxTextField(q, { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.ps_search_people)) }, modifier = Modifier.fillMaxWidth())
                if (s.roster.isEmpty()) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(people, key = { it.userId ?: it.id ?: it.email.orEmpty() }) { m ->
                        val on = m in picked
                        Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - m else picked + m }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.name, m.avatar, 28.dp, userId = m.userId); Spacer(Modifier.width(10.dp))
                            Text(m.name ?: m.email ?: "—", fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
                            NxCheckbox(on, { picked = if (on) picked - m else picked + m })
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(picked.mapNotNull { it.userId ?: it.id }, groupName.ifBlank { null }, makeGroup) }, enabled = picked.isNotEmpty() && !s.busy) {
                Text(stringResource(if (ChatRules.newChatType(picked.size, makeGroup) == "GROUP") R.string.chat_create_group else R.string.chat_start))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
