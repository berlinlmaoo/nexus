package id.znetworks.nexus.feature.inbox

import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.DirectionsWalk
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
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
        fun of(type: String?): InboxGroup {
            val t = type.orEmpty().lowercase()
            return when {
                t.startsWith("task") || t.startsWith("comment") || t.startsWith("project") || t == "status_update" || t.startsWith("quest") || t == "streak_at_risk" -> TASKS
                "attendance" in t || "offsite" in t || "dayoff" in t || "red_date" in t -> ATTENDANCE
                t.startsWith("message") || t.startsWith("feed") -> MESSAGES
                t.startsWith("submission") -> SUBMISSIONS
                t.startsWith("complaint") -> TICKETS
                t.startsWith("announcement") -> ANNOUNCEMENTS
                else -> OTHER
            }
        }
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
    private val _state = MutableStateFlow(InboxState())
    val state = _state.asStateFlow()

    init { load() }

    fun load() = viewModelScope.launch {
        try {
            val r = api.list()
            _state.update { it.copy(items = r.notifications, unread = r.unreadCount, loading = false, error = null) }
        } catch (e: ApiError) {
            _state.update { it.copy(loading = false, error = e.describe(getApplication<Application>().resources)) }
        }
    }

    fun setGroup(g: InboxGroup) = _state.update { it.copy(group = g) }

    fun markAll() = viewModelScope.launch {
        runCatching { api.markAllRead() }
        load()
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
    // A new notification while the Inbox is open (user room, Berlin 8 Oct).
    id.znetworks.nexus.core.realtime.LiveRefresh(Unit, liveMs = null, fallbackMs = 60_000, matches = { it.name == id.znetworks.nexus.core.realtime.RealtimeEvents.NEW_NOTIFICATION }) { vm.load().join() }
    val c = Nx.colors
    val shown = remember(s.items, s.group) { if (s.group == InboxGroup.ALL) s.items else s.items.filter { InboxGroup.of(it.type) == s.group } }
    PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.inbox_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                    Text(stringResource(R.string.inbox_unread, s.unread), fontSize = 12.sp, color = c.mutedFg)
                }
                if (s.unread > 0) TextButton(onClick = vm::markAll) { Text(stringResource(R.string.inbox_mark_all)) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                InboxGroup.entries.forEach { g -> FilterChip(s.group == g, { vm.setGroup(g) }, { Text(stringResource(g.label), fontSize = 12.sp) }) }
            }
            when {
                s.loading && s.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                s.error != null && s.items.isEmpty() -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.inbox_load_failed), s.error!!,
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                s.items.isEmpty() -> EmptyState(Icons.Filled.MarkEmailRead, stringResource(R.string.inbox_clean), stringResource(R.string.inbox_clean_sub),
                    stringResource(R.string.try_again), { vm.load() }, Modifier.fillMaxSize())
                shown.isEmpty() -> EmptyState(Icons.Filled.FilterList, stringResource(R.string.inbox_nothing_kind), stringResource(R.string.inbox_nothing_kind_sub),
                    stringResource(R.string.show_all), { vm.setGroup(InboxGroup.ALL) }, Modifier.fillMaxSize())
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(shown, key = { it.id }) { item -> InboxRow(item, onClick = { vm.open(item) }) }
                }
            }
        }
    }
}

/** The row's mark, by kind (Berlin, 8 Oct: a staff member outside the office has its own). */
internal fun inboxIcon(type: String?): ImageVector = when {
    type.orEmpty().lowercase() == "attendance_outside_approver" -> Icons.AutoMirrored.Filled.DirectionsWalk
    else -> when (InboxGroup.of(type)) {
        InboxGroup.TASKS -> Icons.Filled.TaskAlt
        InboxGroup.ATTENDANCE -> Icons.Filled.EventAvailable
        InboxGroup.MESSAGES -> Icons.AutoMirrored.Filled.Chat
        InboxGroup.SUBMISSIONS -> Icons.Filled.Description
        InboxGroup.TICKETS -> Icons.Filled.ConfirmationNumber
        InboxGroup.ANNOUNCEMENTS -> Icons.Filled.Campaign
        else -> Icons.Filled.Notifications
    }
}

@Composable
internal fun InboxRow(item: InboxItem, onClick: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier.fillMaxWidth().background(if (item.read) c.card else c.accentBg, RoundedCornerShape(16.dp))
            .border(1.dp, c.border, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(12.dp),
    ) {
        Box(Modifier.padding(top = 5.dp).size(8.dp).background(if (item.read) Color.Transparent else c.violet, CircleShape))
        Spacer(Modifier.size(8.dp))
        val outside = item.type.orEmpty().lowercase() == "attendance_outside_approver"
        Box(Modifier.size(32.dp).background(if (outside) c.warning.copy(alpha = 0.18f) else c.muted, CircleShape), contentAlignment = Alignment.Center) {
            Icon(inboxIcon(item.type), null, tint = if (outside) c.warningFg else c.mutedFg, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title.orEmpty(), fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.foreground)
            item.message?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = c.mutedFg, maxLines = 3) }
            item.createdAt?.let {
                Text(runCatching { DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale.getDefault()).format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrDefault(""),
                    fontSize = 11.sp, color = c.mutedFg)
            }
        }
    }
}

/**
 * The app-wide announcement queue (iOS AnnouncementModal): active ones not yet seen, one at a time,
 * "Next" / "Got it" marks each seen. A tapped `/dashboard?announcement=<id>` shows it even if seen.
 */
class AnnouncementHost(private val api: InboxApi) {
    val queue = MutableStateFlow<List<Announcement>>(emptyList())

    suspend fun refresh() {
        val active = runCatching { api.activeAnnouncements() }.getOrNull() ?: return
        queue.update { current -> (current + active).distinctBy { it.id } }
    }

    suspend fun showOne(id: String) {
        val a = runCatching { api.announcement(id) }.getOrNull() ?: return
        queue.update { current -> listOf(a) + current.filterNot { it.id == id } }
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
                    OutlinedButton(onClick = { pdfOpen = true }, modifier = Modifier.fillMaxWidth(),
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
