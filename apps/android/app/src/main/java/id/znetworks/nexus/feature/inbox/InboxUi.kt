package id.znetworks.nexus.feature.inbox

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.DirectionsWalk
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material.icons.filled.Description
import android.app.Application
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Filter groups, as the iOS bell panel. */
enum class InboxGroup(val label: Int) {
    ALL(R.string.inbox_all), TASKS(R.string.tab_tasks), ATTENDANCE(R.string.attendance_title), MESSAGES(R.string.inbox_messages),
    SUBMISSIONS(R.string.submissions_title), TICKETS(R.string.inbox_tickets), ANNOUNCEMENTS(R.string.inbox_announcements), OTHER(R.string.inbox_other);

    companion object {
        /** The web's buckets (InboxRules.group). */
        fun of(type: String?): InboxGroup = InboxRules.group(type)
    }
}

data class InboxState(
    val items: List<InboxItem> = emptyList(),
    val unread: Int = 0,
    val loading: Boolean = true,
    val error: String? = null,
    val group: InboxGroup = InboxGroup.ALL,
)

class InboxViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val api = InboxApi(c.api)
    private val pendingDeletes = linkedMapOf<String, InboxItem>()
    private val _state = MutableStateFlow(InboxState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        try {
            val r = api.list()
            _state.update { it.copy(items = r.notifications.filterNot { row -> row.id in pendingDeletes }, unread = (r.unreadCount - pendingDeletes.values.count { row -> !row.read }).coerceAtLeast(0), loading = false, error = null) }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(getApplication<Application>().resources)) }
        }
    }

    fun setGroup(g: InboxGroup) = _state.update { it.copy(group = g) }

    fun markAll() = viewModelScope.launch {
        runCatching { api.markAllRead() }
        load()
    }

    fun hide(item: InboxItem) {
        pendingDeletes[item.id] = item
        _state.update { s -> if (s.items.none { it.id == item.id }) s else s.copy(items = s.items.filterNot { it.id == item.id }, unread = if (item.read) s.unread else (s.unread - 1).coerceAtLeast(0)) }
    }

    fun restore(item: InboxItem) {
        pendingDeletes.remove(item.id)
        _state.update { s -> if (s.items.any { it.id == item.id }) s else s.copy(items = (s.items + item).sortedByDescending { it.createdAt }, unread = s.unread + if (item.read) 0 else 1) }
    }

    /** Committed only after the Undo snackbar expires. A failed delete restores this row only. */
    fun delete(item: InboxItem, onResult: (Boolean) -> Unit) {
        hide(item)
        viewModelScope.launch {
            val ok = runCatching { api.delete(item.id) }.isSuccess
            if (ok) pendingDeletes.remove(item.id)
            if (!ok) restore(item)
            c.badges.setInbox(_state.value.unread)
            onResult(ok)
        }
    }

    fun markRead(item: InboxItem) {
        if (item.read) return
        _state.update { s -> s.copy(items = s.items.map { if (it.id == item.id) it.copy(read = true) else it }, unread = (s.unread - 1).coerceAtLeast(0)) }
        viewModelScope.launch { runCatching { api.markRead(item.id) }; c.badges.setInbox(_state.value.unread) }
    }

    /** Routes exactly like a push tap (API.md §2.5 Inbox). */
    fun open(item: InboxItem) {
        if (!item.read) viewModelScope.launch {
            runCatching { api.markRead(item.id) }
            _state.update { s -> s.copy(items = s.items.map { if (it.id == item.id) it.copy(read = true) else it }, unread = (s.unread - 1).coerceAtLeast(0)) }
        }
        c.router.open(Links.forNotification(item.type, item.link, item.taskId, item.projectId))
    }
}

@Composable
fun InboxScreen(vm: InboxViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    // A new notification while the Inbox is open (user room, owner 8 Oct).
    id.znetworks.nexus.core.realtime.LiveRefresh(Unit, liveMs = null, fallbackMs = 60_000, matches = { it.name == id.znetworks.nexus.core.realtime.RealtimeEvents.NEW_NOTIFICATION }) { vm.load().join() }
    val c = Nx.colors
    val context = LocalContext.current
    val snackbars = remember { androidx.compose.material3.SnackbarHostState() }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // Unread ones and what was read this week (web activeNotifications).
    val active = remember(s.items) { InboxRules.active(s.items) }
    val shown = remember(active, s.group) { InboxRules.filter(active, s.group) }
    // All + only the kinds that have something, each with its count; a single kind has nothing to choose (web).
    val tabs = remember(active) { InboxRules.tabs(active.map { it.type }) }
    Box(Modifier.fillMaxSize()) {
    PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.nav_notifications), subtitle = stringResource(R.string.sub_inbox),
                tabs = if (tabs.size > 2 && active.isNotEmpty()) ({
                    id.znetworks.nexus.ui.components.PageTabs(tabs.map { (g, n) -> id.znetworks.nexus.ui.components.PageTab(g, stringResource(g.label), n) }, s.group, vm::setGroup)
                }) else null) {
                // Always there, like the web's "Mark all as read".
                id.znetworks.nexus.ui.components.HeaderIconButton(Icons.Filled.Alarm, stringResource(R.string.rem_title), {
                    (context.applicationContext as id.znetworks.nexus.NexusApplication).container.router.open(id.znetworks.nexus.core.nav.Target.Reminders)
                })
                if (active.isNotEmpty()) id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.inbox_mark_all), vm::markAll, compact = true)
            }
            when {
                s.loading && s.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null && s.items.isEmpty() -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.inbox_load_failed), s.error!!,
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                active.isEmpty() -> EmptyState(Icons.Filled.MarkEmailRead, stringResource(R.string.inbox_none), stringResource(R.string.inbox_clean_sub),
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                shown.isEmpty() -> EmptyState(Icons.Filled.FilterList, stringResource(R.string.inbox_kind_none), stringResource(R.string.inbox_kind_none_sub),
                    stringResource(R.string.show_all), { vm.setGroup(InboxGroup.ALL) }, Modifier.fillMaxSize())
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                    items(shown, key = { it.id }) { item ->
                        InboxRow(item, onClick = { vm.open(item) }, onMarkRead = { vm.markRead(item) }, onDelete = {
                            vm.hide(item)
                            scope.launch {
                                var committed = false
                                try {
                                    val result = snackbars.showSnackbar(context.getString(R.string.inbox_deleted), context.getString(R.string.audit_undo), withDismissAction = true, duration = androidx.compose.material3.SnackbarDuration.Long)
                                    if (result != androidx.compose.material3.SnackbarResult.ActionPerformed) {
                                        committed = true
                                        vm.delete(item) { ok -> if (!ok) id.znetworks.nexus.ui.components.UiNotice.show(context.getString(R.string.inbox_delete_failed)) }
                                    }
                                } finally {
                                    if (!committed) vm.restore(item)
                                }
                            }
                        })
                        androidx.compose.material3.HorizontalDivider(color = c.border.copy(alpha = 0.7f))
                    }
                }
            }
        }
    }
    androidx.compose.material3.SnackbarHost(snackbars, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
    }
}

/** The kind's icon (web notificationMark, lucide → Material). */
internal fun inboxIcon(type: String?): ImageVector = when (InboxRules.mark(type)) {
    InboxRules.Mark.MEETING -> androidx.compose.material.icons.Icons.Filled.Mic
    InboxRules.Mark.OUTSIDE -> Icons.AutoMirrored.Filled.DirectionsWalk
    InboxRules.Mark.MENTION -> Icons.Filled.AlternateEmail
    InboxRules.Mark.ASSIGNED -> Icons.Filled.PersonAdd
    InboxRules.Mark.COMPLETED -> Icons.Filled.TaskAlt
    InboxRules.Mark.CONVERSATION -> Icons.AutoMirrored.Filled.Chat
    InboxRules.Mark.DUE -> Icons.Filled.Alarm
    InboxRules.Mark.ATTENDANCE -> Icons.Filled.EventAvailable
    InboxRules.Mark.ANNOUNCEMENT -> Icons.Filled.Campaign
    InboxRules.Mark.TICKET -> Icons.Filled.SupportAgent
    InboxRules.Mark.DOCUMENT -> Icons.Filled.Description
    InboxRules.Mark.QUEST -> Icons.Filled.EmojiEvents
    InboxRules.Mark.MEMBERSHIP -> Icons.Filled.MeetingRoom
    InboxRules.Mark.STATUS -> Icons.Filled.Timeline
    InboxRules.Mark.BELL -> Icons.Filled.Notifications
}

/** The kind's tone: a soft fill and its ink (web tone classes). */
@Composable
private fun inboxTone(type: String?): Pair<Color, Color> {
    val c = Nx.colors
    val ink = when (InboxRules.mark(type)) {
        InboxRules.Mark.MEETING -> if (type == "meeting_notes_failed") c.dangerText else c.violetText
        InboxRules.Mark.MENTION -> Color(0xFF0284C7)
        InboxRules.Mark.ASSIGNED, InboxRules.Mark.STATUS -> c.foreground
        InboxRules.Mark.COMPLETED -> c.success
        InboxRules.Mark.CONVERSATION -> c.violetText
        InboxRules.Mark.DUE, InboxRules.Mark.OUTSIDE, InboxRules.Mark.QUEST -> c.warningFg
        InboxRules.Mark.ATTENDANCE -> Color(0xFF0F766E)
        InboxRules.Mark.ANNOUNCEMENT -> Color(0xFFC2410C)
        InboxRules.Mark.TICKET -> c.dangerText
        else -> c.mutedFg
    }
    return (if (ink == c.mutedFg || ink == c.foreground) c.muted else ink.copy(alpha = 0.12f)) to ink
}

/**
 * One notification (web inbox row): the sender's face with the kind as a small badge (or the kind's mark for
 * system rows), title, message, the day; Mark as read and Delete at the right, the unread dot.
 */
@Composable
internal fun InboxRow(item: InboxItem, onMarkRead: (() -> Unit)? = null, onDelete: (() -> Unit)? = null, onClick: () -> Unit) {
    val c = Nx.colors
    val (fill, ink) = inboxTone(item.type)
    Row(Modifier.fillMaxWidth().background(if (item.read) c.background else c.accentBg.copy(alpha = 0.35f)).clickable(onClick = onClick)
        .padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
        val actor = item.actor
        if (actor?.id != null) Box {
            id.znetworks.nexus.ui.components.Avatar(actor.name, actor.avatar, size = 36.dp, userId = actor.id)
            Box(Modifier.align(Alignment.BottomEnd).size(18.dp).background(c.card, CircleShape).padding(2.dp)) {
                Box(Modifier.fillMaxSize().background(fill, CircleShape), contentAlignment = Alignment.Center) { Icon(inboxIcon(item.type), null, tint = ink, modifier = Modifier.size(10.dp)) }
            }
        } else Box(Modifier.size(36.dp).background(fill, CircleShape), contentAlignment = Alignment.Center) {
            Icon(inboxIcon(item.type), null, tint = ink, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title.orEmpty(), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = c.foreground, maxLines = 2)
            Text(item.message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.inbox_new), fontSize = 14.sp, color = c.mutedFg, maxLines = 3)
            // The day only (web fmtDay).
            item.createdAt?.let {
                Text(runCatching { AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrDefault(""),
                    fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(top = 4.dp))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            var menu by remember { mutableStateOf(false) }
            Box {
                androidx.compose.material3.IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more), tint = c.mutedFg) }
                androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                    if (!item.read && onMarkRead != null) androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.inbox_mark_read)) }, onClick = { menu = false; onMarkRead() })
                    if (onDelete != null) androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.inbox_delete), color = c.dangerText) }, onClick = { menu = false; onDelete() })
                }
            }
            if (!item.read) Box(Modifier.size(6.dp).background(c.onyx, CircleShape))
        }
    }
}

/**
 * The app-wide announcement queue (iOS AnnouncementModal): active ones not yet seen, one at a time,
 * "Next" / "Got it" marks each seen. A tapped `/dashboard?announcement=<id>` shows it even if seen.
 */
class AnnouncementHost(private val api: InboxApi) {
    val queue = MutableStateFlow<List<Announcement>>(emptyList())
    val loading = MutableStateFlow(true)
    private val loads = java.util.concurrent.atomic.AtomicInteger(0)

    suspend fun refresh() {
        loads.incrementAndGet(); loading.value = true
        try {
            val active = runCatching { api.activeAnnouncements() }.getOrNull() ?: return
            queue.update { current -> (current + active).distinctBy { it.id } }
        } finally { if (loads.decrementAndGet() == 0) loading.value = false }
    }

    suspend fun showOne(id: String) {
        val a = runCatching { api.announcement(id) }.getOrNull() ?: return
        queue.update { current -> if (current.isEmpty()) listOf(a) else listOf(current.first()) + listOf(a).filterNot { it.id == current.first().id } + current.drop(1).filterNot { it.id == id } }
    }

    suspend fun dismiss(a: Announcement) {
        queue.update { it.filterNot { x -> x.id == a.id } }
        runCatching { api.seen(a.id) }
    }
}

@Composable
fun AnnouncementDialog(host: AnnouncementHost) {
    val queue by host.queue.collectAsStateWithLifecycle()
    val a = queue.firstOrNull() ?: return
    val c = Nx.colors
    val context = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // Batch 2 (29 Sep, web AnnouncementModal / iOS 78bfe37): an SP is red with an "SP" badge and its PDF;
    // an Absen Monitor warning is amber and shows the selfie it is about, whole.
    val kind = a.kind ?: "announcement"
    val tone = when {
        kind == "sp" -> c.danger
        kind == "warning" -> c.warning
        a.tone == "success" -> c.success
        a.tone == "warning" -> c.warning
        else -> c.violetText
    }
    var img by remember(a.id) { mutableStateOf<ImageBitmap?>(null) }
    var pdfOpen by remember(a.id) { mutableStateOf(false) }
    LaunchedEffect(a.imageUrl) {
        val url = a.imageUrl ?: return@LaunchedEffect
        val api = (context.applicationContext as NexusApplication).container.api
        img = withContext(Dispatchers.IO) { runCatching { api.bytes(url).let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }.getOrNull() }
    }
    AlertDialog(
        onDismissRequest = {},
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(when (kind) { "sp" -> R.string.an_eyebrow_sp; "warning" -> R.string.an_eyebrow_warning; else -> R.string.an_eyebrow }).uppercase(),
                    fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp, color = tone)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (kind == "sp") {
                        Text("SP", fontSize = 12.sp, fontWeight = FontWeight.Black, color = androidx.compose.ui.graphics.Color.White,
                            modifier = Modifier.background(c.danger, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                        Spacer(Modifier.width(8.dp))
                    } else if (kind == "announcement") { Text("📣 ") }
                    else Text("⚠️ ")
                    Text(a.title.orEmpty(), color = if (kind == "announcement") tone else c.foreground)
                }
            }
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                img?.let {
                    Image(it, null, contentScale = if (kind == "warning") ContentScale.Fit else ContentScale.Crop,
                        modifier = Modifier.fillMaxWidth().heightIn(max = if (kind == "warning") 280.dp else 220.dp).background(c.muted, RoundedCornerShape(12.dp)))
                }
                Text(a.body.orEmpty())
                a.attachmentUrl?.let {
                    NxOutlinedButton(onClick = { pdfOpen = true }, modifier = Modifier.fillMaxWidth(),
                        border = androidx.compose.foundation.BorderStroke(1.dp, c.danger.copy(alpha = 0.4f))) {
                        Icon(Icons.Filled.Description, null, tint = c.danger, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.an_open_pdf), color = c.danger, fontWeight = FontWeight.Bold)
                    }
                    a.attachmentName?.let { n -> Text(n, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, modifier = Modifier.align(Alignment.CenterHorizontally)) }
                }
                a.authorName?.let { Text("— $it", fontSize = 12.sp, color = c.mutedFg) }
            }
        },
        confirmButton = {
            TextButton(onClick = { scope.launch { host.dismiss(a) } }) {
                Text(stringResource(if (queue.size > 1) R.string.next else R.string.got_it), fontWeight = FontWeight.Bold)
            }
        },
    )
    if (pdfOpen) a.attachmentUrl?.let { url ->
        id.znetworks.nexus.ui.components.PdfViewerDialog(url, a.attachmentName ?: "SP.pdf") { pdfOpen = false }
    }
}
