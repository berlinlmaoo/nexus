package id.znetworks.nexus.feature.forms

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.taskStatusLabel
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * A form's Responses (web FormStudio ResponsesTab, iOS a30d094): each response is the task it created, newest
 * first, with who sent it and when; a row opens the task (the answers live on it). Project members only (server:
 * `GET /api/forms/:formId/responses`). Live: `form-responses-changed` to the project's room reloads the list.
 */
@Serializable
data class FormResponses(val total: Int? = null, val projectId: String? = null, val responses: List<FormResponseRow> = emptyList())

@Serializable
data class FormResponseRow(val id: String, val createdAt: String? = null, val submitter: Person? = null, val task: TaskRef? = null) {
    @Serializable data class Person(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
    @Serializable data class TaskRef(val id: String, val title: String? = null, val status: String? = null, val section: String? = null)
}

@Composable
fun FormResponsesScreen(projectId: String, formId: String, onBack: () -> Unit, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    var data by remember { mutableStateOf<FormResponses?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var entered by rememberSaveable { mutableStateOf(false) }
    // Back from a task (moved, renamed, deleted): the list follows.
    LaunchedEffect(Unit) { if (entered) tick++ else entered = true }
    LaunchedEffect(formId, tick) {
        try {
            data = container.api.get("/api/forms/${android.net.Uri.encode(formId)}/responses", FormResponses.serializer()); error = null
        } catch (e: ApiError) { error = e.describe(context.resources) }
    }
    // Held here too: the builder may be opened from the Forms page, where nothing else joined the room.
    id.znetworks.nexus.core.realtime.RealtimeRoom("project:$projectId")
    LaunchedEffect(formId) {
        container.realtime.events.collect { e -> if (RealtimeEvents.formResponses(e, formId)) tick++ }
    }
    val rows = data?.responses.orEmpty()
    Column(Modifier.fillMaxSize().background(c.background)) {
        val n = data?.total ?: rows.size
        PageHeader(stringResource(R.string.fr_title), subtitle = data?.let { pluralStringResource(R.plurals.fr_count, n, n) }, onBack = onBack)
        Box(Modifier.weight(1f)) {
            when {
                data == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                data == null -> EmptyState(Icons.Outlined.Inbox, stringResource(R.string.fr_load_failed), error.orEmpty(), stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
                rows.isEmpty() -> EmptyState(Icons.Outlined.Inbox, stringResource(R.string.fr_empty), stringResource(R.string.fr_empty_sub), stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = { tick++ }) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
                        items(rows, key = { it.id }) { r -> ResponseRow(r) { r.task?.id?.let(onOpenTask) }; HorizontalDivider(color = c.border.copy(alpha = 0.6f)) }
                        item { Text(stringResource(R.string.fr_footer), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(16.dp)) }
                    }
                }
            }
        }
    }
}

private val WHEN = DateTimeFormatter.ofPattern("d MMM HH:mm")

@Composable
private fun ResponseRow(r: FormResponseRow, onOpen: () -> Unit) {
    val c = Nx.colors
    val sender = r.submitter?.name?.takeIf { it.isNotBlank() } ?: r.submitter?.email?.takeIf { it.isNotBlank() } ?: stringResource(R.string.fr_unknown)
    val time = r.createdAt?.let { runCatching { WHEN.withLocale(Locale.getDefault()).format(Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta"))) }.getOrNull() }
    val chip = r.task?.let { t -> t.section?.takeIf { it.isNotBlank() } ?: t.status?.let { s -> taskStatusLabel(s.uppercase()) } }
    Row(Modifier.fillMaxWidth().clickable(enabled = r.task != null, onClick = onOpen).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (r.submitter != null) Avatar(sender, r.submitter.avatar, size = 28.dp) else Box(Modifier.size(28.dp).background(c.muted, CircleShape))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(r.task?.title ?: stringResource(R.string.fr_task_deleted), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                color = if (r.task == null) c.mutedFg else c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (time == null) sender else "$sender · $time", fontSize = 13.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (chip != null) Text(chip, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, maxLines = 1,
            modifier = Modifier.padding(start = 6.dp).clip(RoundedCornerShape(6.dp)).background(c.muted).padding(horizontal = 7.dp, vertical = 3.dp))
    }
}
